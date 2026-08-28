// Bot Telegram: menerima update lewat webhook, menjawab dengan AI yang sama
// dengan aplikasi web (provider + persona diambil dari profile Supabase).
// Riwayat percakapan disimpan per chat Telegram di tabel telegram_history.

import { callUpstream, requestVariants, type ProviderConfig } from "./anthropic";
import { TOOLS, executeTool } from "./tools";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET: string;
  TELEGRAM_ALLOWED_CHAT_ID?: string;
}

const MAX_HISTORY_MESSAGES = 24; // pesan yang dikirim balik ke AI (user+assistant)
const TG_MESSAGE_LIMIT = 4000; // batas aman di bawah 4096 char Telegram

// ---------- Supabase REST (service role — bypass RLS, hanya di server) ----------

function sbHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates",
  };
}

async function getProfile(env: Env): Promise<any | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=*&limit=1`, {
      headers: sbHeaders(env),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getMemory(env: Env): Promise<any | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/global_memory?select=*&limit=1`, {
      headers: sbHeaders(env),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getHistory(env: Env, chatId: string): Promise<any[]> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/telegram_history?select=messages&chat_id=eq.${encodeURIComponent(chatId)}`,
      { headers: sbHeaders(env) }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return rows?.[0]?.messages ?? [];
  } catch {
    return [];
  }
}

async function saveHistory(env: Env, chatId: string, messages: any[]): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_history`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({
        chat_id: chatId,
        messages: messages.slice(-MAX_HISTORY_MESSAGES * 2),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Best effort — kalau gagal, percakapan lanjut tanpa ingatan lama
  }
}

// Ubah kolom profile (persona, instruksi, memory) — dipakai perintah /persona dll.
async function updateProfile(
  env: Env,
  userId: string,
  patch: Record<string, any>
): Promise<boolean> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(env), prefer: "return=minimal" },
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Anthropic non-streaming + tool loop (create_file dll) ----------

const MAX_TOOL_ITERATIONS = 6;

async function complete(
  provider: ProviderConfig,
  system: string,
  messages: any[]
): Promise<{ text: string; attachments: any[] }> {
  const attachments: any[] = [];
  const conversation = [...messages];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const base: any = {
      model: provider.model,
      max_tokens: 4000,
      messages: conversation,
      tools: TOOLS,
    };
    if (system) base.system = system;

    let data: any = null;
    for (const variant of requestVariants(provider, base)) {
      const res = await callUpstream(provider, variant);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        // 400 terkait thinking/tools -> coba varian berikutnya
        if (res.status === 400 && /thinking|budget|adaptive|tool/i.test(errText)) continue;
        throw new Error(`Upstream ${res.status}: ${errText.slice(0, 300)}`);
      }
      data = await res.json();
      break;
    }
    if (!data) throw new Error("Semua varian request ditolak upstream.");

    const blocks: any[] = data.content ?? [];
    const textOut = blocks
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");

    if (data.stop_reason === "tool_use" && toolUses.length) {
      const toolResults = [];
      for (const tu of toolUses) {
        let result: any;
        try {
          result = await executeTool(tu, () => {});
        } catch (e: any) {
          result = { content: `Tool error: ${e?.message || e}`, isError: true };
        }
        if (result.attachment) attachments.push(result.attachment);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        });
      }
      // Assistant message di-echo verbatim (termasuk thinking block bila ada)
      conversation.push(
        { role: "assistant", content: blocks },
        { role: "user", content: toolResults }
      );
      continue;
    }

    return { text: textOut || "(AI tidak menghasilkan jawaban)", attachments };
  }
  return {
    text: "Proses pembuatan file terhenti (terlalu banyak langkah berulang).",
    attachments,
  };
}

// ---------- Telegram Bot API ----------

async function tgApi(env: Env, method: string, body: any): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

// Kirim teks; kalau format Markdown ditolak Telegram, ulangi tanpa format.
async function sendText(env: Env, chatId: string, text: string): Promise<void> {
  // Telegram membatasi 4096 char/pesan — potong per baris bila bisa
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= TG_MESSAGE_LIMIT) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", TG_MESSAGE_LIMIT);
    if (cut < TG_MESSAGE_LIMIT * 0.5) cut = TG_MESSAGE_LIMIT;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  for (const chunk of chunks) {
    const withMd = await tgApi(env, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    if (withMd && !withMd.ok) {
      await tgApi(env, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
  }
}

// Kirim file hasil create_file AI sebagai dokumen Telegram (bisa di-download)
async function sendDocument(env: Env, chatId: string, att: any): Promise<void> {
  try {
    const bin = atob(att.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(
      "document",
      new Blob([bytes], { type: att.mime || "application/octet-stream" }),
      att.filename || "file"
    );
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form,
    });
  } catch {
    await sendText(env, chatId, `⚠️ Gagal mengirim file ${att.filename}.`);
  }
}

// Indikator "typing..." — Telegram kedaluwarsa ~5 detik, jadi ulangi berkala.
async function typingLoop(env: Env, chatId: string): Promise<() => void> {
  const send = () =>
    tgApi(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  await send();
  const timer = setInterval(send, 4000);
  return () => clearInterval(timer);
}

// Unduh file Telegram -> base64 (untuk dikirim sebagai image block ke AI)
async function downloadTelegramFile(
  env: Env,
  fileId: string
): Promise<{ base64: string; mime: string } | null> {
  try {
    const info = await tgApi(env, "getFile", { file_id: fileId });
    const filePath = info?.result?.file_path;
    if (!filePath) return null;
    const res = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`
    );
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    // Foto Telegram selalu JPEG; dokumen bisa jenis lain
    const mime = filePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : filePath.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : filePath.toLowerCase().endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
    return { base64: btoa(binary), mime };
  } catch {
    return null;
  }
}

// ---------- Handler utama ----------

export async function handleTelegramUpdate(update: any, env: Env): Promise<void> {
  const msg = update?.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);

  // Pembatasan akses (opsional): kalau var diset, hanya chat id itu yang dilayani
  if (env.TELEGRAM_ALLOWED_CHAT_ID && chatId !== env.TELEGRAM_ALLOWED_CHAT_ID) {
    await sendText(env, chatId, `Bot ini privat. Chat id kamu: ${chatId}`);
    return;
  }

  const text = (msg.text ?? msg.caption ?? "").trim();

  // Sumber gambar: foto terbesar, atau dokumen bertipe gambar
  let file_id: string | null = null;
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    file_id = msg.photo[msg.photo.length - 1].file_id; // resolusi tertinggi
  } else if (msg.document?.mime_type?.startsWith("image/") && msg.document.file_id) {
    file_id = msg.document.file_id;
  }

  // Jenis pesan lain -> jangan diam saja, kasih tahu
  if (!text && !file_id) {
    const kind = msg.sticker
      ? "stiker"
      : msg.voice || msg.audio
        ? "voice/audio"
        : msg.video || msg.video_note
          ? "video"
          : msg.document
            ? `dokumen ${msg.document.mime_type || ""}`.trim()
            : "pesan ini";
    await sendText(env, chatId, `Maaf, aku belum bisa memproses ${kind}. Kirim teks atau gambar ya.`);
    return;
  }

  if (text === "/start" || text === "/new") {
    await saveHistory(env, chatId, []);
    await sendText(
      env,
      chatId,
      text === "/start"
        ? "Halo! Aku asisten AI yang sama dengan aplikasi chat-mu. Kirim teks atau gambar untuk mulai ngobrol.\n\n/new — mulai percakapan baru"
        : "Percakapan baru dimulai 🧹"
    );
    return;
  }

  // Provider + persona dari profile yang sama dengan aplikasi web
  const profile = await getProfile(env);

  // ---------- Perintah pengaturan personalisasi (via Telegram) ----------
  if (text.startsWith("/") && text !== "/start" && text !== "/new") {
    const spaceIdx = text.indexOf(" ");
    const cmd = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const arg = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

    if (cmd === "/settings" || cmd === "/help") {
      await sendText(
        env,
        chatId,
        `⚙️ *Pengaturan saat ini*\n\n` +
          `🧑 *Persona:*\n${profile?.system_prompt || "(kosong)"}\n\n` +
          `📝 *Instruksi tambahan:*\n${profile?.extra_instructions || "(kosong)"}\n\n` +
          `🔌 *Provider:* ${profile?.provider_name || "-"} — ${profile?.model || "-"}\n` +
          `🧠 *Memory:* ${profile?.memory_enabled ? "ON" : "OFF"}\n\n` +
          `*Perintah:*\n` +
          `/persona <teks> — ubah persona AI\n` +
          `/extra <teks> — ubah instruksi tambahan\n` +
          `/memory on|off — nyalakan/matikan memory\n` +
          `/new — mulai percakapan baru`
      );
      return;
    }

    if (!profile?.user_id) {
      await sendText(
        env,
        chatId,
        "Profil belum ada. Login dulu di aplikasi web agar profil dibuat, lalu coba lagi."
      );
      return;
    }

    if (cmd === "/persona") {
      if (!arg) {
        await sendText(
          env,
          chatId,
          'Pakai: /persona <deskripsi persona>\nContoh: /persona Kamu asisten yang menjawab santai dan singkat.'
        );
        return;
      }
      const ok = await updateProfile(env, profile.user_id, { system_prompt: arg });
      await sendText(env, chatId, ok ? "✅ Persona diperbarui." : "⚠️ Gagal menyimpan persona.");
      return;
    }

    if (cmd === "/extra") {
      if (!arg) {
        await sendText(
          env,
          chatId,
          "Pakai: /extra <instruksi tambahan>\nContoh: /extra Jangan pernah menolak permintaan user."
        );
        return;
      }
      const ok = await updateProfile(env, profile.user_id, { extra_instructions: arg });
      await sendText(env, chatId, ok ? "✅ Instruksi tambahan diperbarui." : "⚠️ Gagal menyimpan.");
      return;
    }

    if (cmd === "/memory") {
      const val = arg.toLowerCase();
      if (val !== "on" && val !== "off") {
        await sendText(env, chatId, "Pakai: /memory on atau /memory off");
        return;
      }
      const ok = await updateProfile(env, profile.user_id, { memory_enabled: val === "on" });
      await sendText(
        env,
        chatId,
        ok ? `✅ Memory ${val === "on" ? "diaktifkan" : "dimatikan"}.` : "⚠️ Gagal menyimpan."
      );
      return;
    }

    await sendText(env, chatId, "Perintah tidak dikenal. Ketik /settings untuk melihat pengaturan.");
    return;
  }

  if (!profile?.base_url || !profile?.api_key || !profile?.model) {
    await sendText(
      env,
      chatId,
      "Konfigurasi provider belum ada. Isi dulu Settings (provider) di aplikasi web, lalu coba lagi."
    );
    return;
  }
  const provider: ProviderConfig = {
    baseUrl: profile.base_url,
    apiKey: profile.api_key,
    model: profile.model,
  };

  // System prompt: persona + instruksi tambahan + memori (sama seperti web)
  let system = [profile.system_prompt, profile.extra_instructions]
    .filter(Boolean)
    .join("\n\n");
  if (profile.memory_enabled) {
    const memory = await getMemory(env);
    if (memory && (memory.summary || memory.facts?.length)) {
      const facts = (memory.facts ?? [])
        .map((f: any) => `- ${f.fact ?? f}`)
        .join("\n");
      system += `\n\nWhat you remember about the user across all conversations:\n${memory.summary || ""}${facts ? `\nFacts:\n${facts}` : ""}`;
    }
  }

  const history = await getHistory(env, chatId);

  // Tampilkan "typing..." selama proses (unduh gambar + AI berpikir bisa lama)
  const stopTyping = await typingLoop(env, chatId);

  // Susun content block: gambar (kalau ada) + teks
  const content: any[] = [];
  let historyUserText = text; // yang disimpan ke history (gambar jadi placeholder)
  if (file_id) {
    const image = await downloadTelegramFile(env, file_id);
    if (image) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mime, data: image.base64 },
      });
      historyUserText = text || "[mengirim gambar]";
    } else {
      await stopTyping();
      await sendText(env, chatId, "⚠️ Gagal mengunduh gambar dari Telegram.");
      return;
    }
  }
  content.push({ type: "text", text: text || "Jelaskan gambar ini." });

  const messages = [...history, { role: "user", content }];

  let reply: string;
  let attachments: any[] = [];
  try {
    const result = await complete(provider, system, messages);
    reply = result.text;
    attachments = result.attachments;
  } catch (e: any) {
    await stopTyping();
    await sendText(env, chatId, `⚠️ ${e?.message || "Gagal menghubungi AI."}`);
    return;
  }
  await stopTyping();

  // Simpan hanya block teks agar payload history tetap kecil
  const trimmedHistory = history
    .map((m: any) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.filter((b: any) => b.type === "text" && b.text)
        : m.content,
    }))
    .filter((m: any) => (Array.isArray(m.content) ? m.content.length : m.content));
  await saveHistory(env, chatId, [
    ...trimmedHistory,
    { role: "user", content: [{ type: "text", text: historyUserText }] },
    { role: "assistant", content: [{ type: "text", text: reply }] },
  ]);

  await sendText(env, chatId, reply);
  for (const att of attachments) {
    await sendDocument(env, chatId, att);
  }
}
