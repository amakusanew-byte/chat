// Worker utama: API (/api/*) + fallback ke static assets (frontend React).

import { Hono } from "hono";
import { runChat } from "./anthropic";
import { TOOLS, executeTool } from "./tools";
import { inspectArchive } from "./rar";
import { refreshMemory } from "./memory";
import { handleTelegramUpdate } from "./telegram";

type Bindings = {
  ASSETS: any;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_SECRET?: string;
  TELEGRAM_ALLOWED_CHAT_ID?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Streaming chat: response SSE berisi event status/thinking/text/file/done/error
app.post("/api/chat", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body JSON tidak valid" }, 400);
  }
  if (!body?.provider?.baseUrl || !body?.provider?.apiKey || !body?.provider?.model) {
    return c.json({ error: "Konfigurasi provider belum lengkap (base URL, model, API key)." }, 400);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = async (obj: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  (async () => {
    try {
      const result = await runChat({
        provider: body.provider,
        system: body.system || "",
        messages: body.messages || [],
        tools: TOOLS,
        onEvent: (ev) => {
          send(ev).catch(() => {});
        },
        executeTool,
      });
      await send({
        type: "done",
        content: result.content,
        attachments: result.attachments,
        stopReason: result.stopReason,
        usage: result.usage,
      });
    } catch (e: any) {
      try {
        await send({ type: "error", message: e?.message || String(e) });
      } catch {}
    } finally {
      try {
        await writer.close();
      } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
});

// Webhook bot Telegram. Verifikasi secret token dari header X-Telegram-Bot-Api-Secret-Token.
app.post("/api/telegram/webhook/:secret", async (c) => {
  const env = c.env as any;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_SECRET) {
    return c.json({ error: "Telegram belum dikonfigurasi" }, 503);
  }
  // Secret ada di path — cukup sebagai verifikasi (Telegram mengirim header juga,
  // tapi cek path membuat setup lebih simpel dan tetap tidak bisa ditebak).
  if (c.req.param("secret") !== env.TELEGRAM_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let update: any;
  try {
    update = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  // Balas 200 dulu supaya Telegram tidak retry; proses update setelahnya.
  c.executionCtx.waitUntil(
    handleTelegramUpdate(update, env).catch((e) =>
      console.error("telegram error:", e?.message || e)
    )
  );
  return c.json({ ok: true });
});

// Inspeksi RAR: multipart "file" -> daftar isi + isi file teks
app.post("/api/archive/inspect", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "Field 'file' tidak ditemukan" }, 400);
    }
    const entries = await inspectArchive(await file.arrayBuffer());
    return c.json({ filename: file.name, files: entries });
  } catch (e: any) {
    return c.json({ error: `Gagal membaca arsip: ${e?.message || e}` }, 500);
  }
});

// Refresh memori global (non-streaming)
app.post("/api/memory/refresh", async (c) => {
  try {
    const body = await c.req.json();
    const memory = await refreshMemory(body);
    return c.json(memory);
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

// Semua rute lain -> static assets (frontend)
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
