// Bot Telegram: menerima update lewat webhook, menjawab dengan AI yang sama
// dengan aplikasi web (provider + persona diambil dari profile Supabase).
// Riwayat percakapan disimpan per chat Telegram di tabel telegram_history.

import { callUpstream, requestVariants, type ProviderConfig } from "./anthropic";

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

// ---------- Anthropic non-streaming (jawaban utuh, sederhana untuk bot) ----------

async function complete(
  provider: ProviderConfig,
  system: string,
  messages: any[]
): Promise<string> {
  const base: any = {
    model: provider.model,
    max_tokens: 4000,
    messages,
  };
  if (system) base.system = system;

  let lastText = "";
  for (const variant of requestVariants(provider, base)) {
    const res = await callUpstream(provider, variant);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 400 terkait thinking/tools -> coba varian berikutnya
      if (res.status === 400 && /thinking|budget|adaptive|tool/i.test(text)) continue;
      throw new Error(`Upstream ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    lastText = (data.content ?? [])
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return lastText || "(AI tidak menghasilkan jawaban)";
  }
  throw new Error("Semua varian request ditolak upstream.");
}

// ---------- Telegram Bot API ----------

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
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    }).catch(() => {});
  }
}

// ---------- Handler utama ----------

export async function handleTelegramUpdate(update: any, env: Env): Promise<void> {
  const msg = update?.message;
  if (!msg?.text) return; // sticker/foto dll belum didukung
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  // Pembatasan akses (opsional): kalau var diset, hanya chat id itu yang dilayani
  if (env.TELEGRAM_ALLOWED_CHAT_ID && chatId !== env.TELEGRAM_ALLOWED_CHAT_ID) {
    await sendText(
      env,
      chatId,
      `Bot ini privat. Chat id kamu: \`${chatId}\` — minta owner mendaftarkannya.`
    );
    return;
  }

  if (text === "/start" || text === "/new") {
    await saveHistory(env, chatId, []);
    await sendText(
      env,
      chatId,
      text === "/start"
        ? "Halo! Aku asisten AI yang sama dengan aplikasi chat-mu. Kirim apa saja untuk mulai ngobrol.\n\n`/new` — mulai percakapan baru"
        : "Percakapan baru dimulai 🧹"
    );
    return;
  }

  // Provider + persona dari profile yang sama dengan aplikasi web
  const profile = await getProfile(env);
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
  const messages = [
    ...history,
    { role: "user", content: [{ type: "text", text }] },
  ];

  let reply: string;
  try {
    reply = await complete(provider, system, messages);
  } catch (e: any) {
    await sendText(env, chatId, `⚠️ ${e?.message || "Gagal menghubungi AI."}`);
    return;
  }

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
    { role: "user", content: [{ type: "text", text }] },
    { role: "assistant", content: [{ type: "text", text: reply }] },
  ]);

  await sendText(env, chatId, reply);
}
