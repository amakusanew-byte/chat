// Worker utama: API (/api/*) + fallback ke static assets (frontend React).

import { Hono } from "hono";
import { runChat } from "./anthropic";
import { TOOLS, executeTool } from "./tools";
import { inspectArchive } from "./rar";
import { refreshMemory } from "./memory";

const app = new Hono<{ Bindings: { ASSETS: any } }>();

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
