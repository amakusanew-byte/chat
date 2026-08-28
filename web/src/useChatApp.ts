// Hook pusat: state + semua aksi chat (kirim, edit, delete, regenerate, memory).

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./api/supabase";
import { streamChat } from "./api/chat";
import type {
  Attachment,
  Block,
  Chat,
  ChatMessage,
  FileAttachment,
  MemoryData,
  Profile,
  StreamingState,
} from "./types";
import { DEFAULT_PROVIDER } from "./types";
import { fileToB64 } from "./utils";

const IDLE_STREAMING: StreamingState = {
  active: false,
  phase: "",
  thinking: "",
  text: "",
  files: [],
};

export interface ArchiveInspection {
  filename: string;
  files: { name: string; size: number; isText: boolean; content?: string }[];
}

export function useChatApp() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memory, setMemory] = useState<MemoryData | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({});
  const [streaming, setStreaming] = useState<StreamingState>(IDLE_STREAMING);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const userRef = useRef<any>(null);
  const profileRef = useRef<Profile | null>(null);
  const memoryRef = useRef<MemoryData | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const activeChatRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => void (profileRef.current = profile), [profile]);
  useEffect(() => void (memoryRef.current = memory), [memory]);
  useEffect(() => void (chatsRef.current = chats), [chats]);
  useEffect(() => void (messagesRef.current = messagesByChat), [messagesByChat]);
  useEffect(() => void (activeChatRef.current = activeChatId), [activeChatId]);

  // ---------- Muat data awal ----------
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("chat_token");
      if (token) {
        try {
          const u = await supabase.getUser(token);
          tokenRef.current = token;
          userRef.current = u;
          setUser(u);
          await loadUserData(u.id, token);
        } catch {
          localStorage.removeItem("chat_token");
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUserData(userId: string, token: string) {
    // Profil (buat otomatis kalau belum ada, prefill provider default dari ai.txt)
    let rows = await supabase.select(token, "profiles", "select=*");
    if (!Array.isArray(rows) || !rows.length) {
      rows = await supabase.insert(
        token,
        "profiles",
        [{ user_id: userId, ...DEFAULT_PROVIDER }],
        { returning: true }
      );
    }
    setProfile(rows[0]);

    // Memori global
    const memRows = await supabase.select(token, "global_memory", "select=*");
    if (Array.isArray(memRows) && memRows.length) setMemory(memRows[0]);

    // Daftar chat
    const chatRows = await supabase.select(
      token,
      "chats",
      "select=*&order=updated_at.desc"
    );
    setChats(Array.isArray(chatRows) ? chatRows : []);
  }

  function handleAuth(u: any, token: string) {
    localStorage.setItem("chat_token", token);
    tokenRef.current = token;
    userRef.current = u;
    setUser(u);
    loadUserData(u.id, token).catch((e) => setError(String(e?.message || e)));
  }

  async function logout() {
    if (tokenRef.current) await supabase.signOut(tokenRef.current).catch(() => {});
    localStorage.removeItem("chat_token");
    tokenRef.current = null;
    userRef.current = null;
    setUser(null);
    setProfile(null);
    setMemory(null);
    setChats([]);
    setActiveChatId(null);
    setMessagesByChat({});
  }

  // ---------- Helper ----------
  const messages = activeChatId ? messagesByChat[activeChatId] ?? [] : [];

  function toApiMessage(m: ChatMessage): { role: string; content: any } | null {
    if (m.role === "user") {
      const blocks = m.content.filter((b) => b.type === "text" || b.type === "image");
      if (!blocks.length) return null;
      return {
        role: "user",
        content: blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text! : blocks,
      };
    }
    // Assistant: hanya block teks (thinking/tool_use tidak direplay)
    const blocks = m.content.filter((b) => b.type === "text" && b.text);
    if (!blocks.length) return null;
    return { role: "assistant", content: blocks };
  }

  function buildSystem(): string {
    const p = profileRef.current;
    const parts: string[] = [];
    if (p?.system_prompt?.trim()) parts.push(p.system_prompt.trim());
    if (p?.extra_instructions?.trim()) parts.push(p.extra_instructions.trim());
    if (p?.memory_enabled) {
      const mem = memoryRef.current;
      const block: string[] = ["What you remember about the user across all conversations:"];
      if (mem?.summary) block.push(mem.summary);
      if (mem?.facts?.length) {
        block.push("Facts:\n" + mem.facts.map((f) => "- " + f.fact).join("\n"));
      }
      if (block.length > 1) parts.push(block.join("\n\n"));
    }
    if (!parts.length) parts.push("You are a helpful, concise assistant.");
    return parts.join("\n\n");
  }

  function toRow(m: ChatMessage) {
    return {
      id: m.id,
      chat_id: m.chat_id,
      user_id: userRef.current?.id,
      role: m.role,
      content: m.content,
      attachments: m.attachments ?? [],
    };
  }

  // ---------- Kompletasi (inti streaming) ----------
  const runCompletion = useCallback(async (chatId: string) => {
    const p = profileRef.current;
    if (!p || !tokenRef.current) return;

    const history = messagesRef.current[chatId] ?? [];
    const apiMessages = history.map(toApiMessage).filter(Boolean) as any[];
    if (!apiMessages.length) return;

    const acc = { thinking: "", text: "", files: [] as FileAttachment[] };
    setStreaming({ active: true, phase: "connecting", ...acc });
    const controller = new AbortController();
    abortRef.current = controller;
    let doneData: any = null;
    let err: string | null = null;

    try {
      await streamChat(
        {
          provider: {
            baseUrl: p.base_url,
            apiKey: p.api_key,
            model: p.model,
          },
          system: buildSystem(),
          messages: apiMessages,
        },
        {
          onStatus: (phase) => setStreaming((s) => ({ ...s, phase: phase as any })),
          onThinkingDelta: (t) => {
            acc.thinking += t;
            setStreaming((s) => ({ ...s, phase: "thinking", thinking: acc.thinking }));
          },
          onTextDelta: (t) => {
            acc.text += t;
            setStreaming((s) => ({ ...s, phase: "writing", text: acc.text }));
          },
          onFile: (f) => {
            acc.files.push(f);
            setStreaming((s) => ({ ...s, files: [...acc.files] }));
          },
          onDone: (d) => {
            doneData = d;
          },
          onError: (m) => {
            err = m;
          },
        },
        controller.signal
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") err = e?.message || String(e);
    }
    abortRef.current = null;
    setStreaming(IDLE_STREAMING);

    let content: Block[];
    let attachments: Attachment[];
    if (doneData) {
      content = doneData.content ?? [];
      attachments = doneData.attachments ?? acc.files;
    } else {
      content = [];
      if (acc.thinking) content.push({ type: "thinking", thinking: acc.thinking });
      if (acc.text) content.push({ type: "text", text: acc.text });
      attachments = acc.files;
    }

    if (!content.length && !attachments.length) {
      setError(err || "Tidak ada respons dari model.");
      return;
    }

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      role: "assistant",
      content,
      attachments,
      created_at: new Date().toISOString(),
    };
    setMessagesByChat((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] ?? []), assistantMsg],
    }));

    try {
      const now = new Date().toISOString();
      await supabase.insert(tokenRef.current, "messages", [toRow(assistantMsg)]);
      await supabase.update(tokenRef.current, "chats", `id=eq.${chatId}`, { updated_at: now });
      setChats((prev) => {
        const cur = prev.find((c) => c.id === chatId);
        if (!cur) return prev;
        return [{ ...cur, updated_at: now }, ...prev.filter((c) => c.id !== chatId)];
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    }

    // Auto refresh memori tiap 10 pesan assistant (jika memory aktif)
    if (profileRef.current?.memory_enabled) {
      const count = Number(localStorage.getItem("msgSinceRefresh") ?? "0") + 1;
      localStorage.setItem("msgSinceRefresh", String(count));
      if (count >= 10) {
        localStorage.setItem("msgSinceRefresh", "0");
        refreshMemory(true).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStreaming() {
    abortRef.current?.abort();
  }

  // ---------- Kirim pesan ----------
  const sendMessage = useCallback(
    async (text: string, images: File[], archives: ArchiveInspection[]) => {
      const token = tokenRef.current;
      const p = profileRef.current;
      if (!token || !p || streaming.active) return;
      setError(null);

      try {
        // Buat chat bila belum ada (lazy)
        let chatId = activeChatRef.current;
        if (!chatId) {
          chatId = crypto.randomUUID();
          const title = (text.trim() || (images[0]?.name ?? archives[0]?.filename ?? "Chat baru")).slice(0, 60);
          const now = new Date().toISOString();
          const chat: Chat = { id: chatId, title, created_at: now, updated_at: now };
          setChats((prev) => [chat, ...prev]);
          setActiveChatId(chatId);
          setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }));
          activeChatRef.current = chatId;
          await supabase.insert(token, "chats", [
            { id: chatId, user_id: userRef.current?.id, title },
          ]);
        }

        // Susun content blocks: teks + gambar + isi RAR
        const blocks: Block[] = [];
        const attachments: Attachment[] = [];
        if (text.trim()) blocks.push({ type: "text", text: text.trim() });
        for (const img of images) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.type || "image/png",
              data: await fileToB64(img),
            },
          });
        }
        for (const arc of archives) {
          blocks.push({ type: "text", text: archiveToText(arc) });
          attachments.push({
            type: "archive",
            filename: arc.filename,
            files: arc.files.map((f) => ({ name: f.name, size: f.size, isText: f.isText })),
          });
        }
        if (!blocks.length) return;

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          chat_id: chatId,
          role: "user",
          content: blocks,
          attachments,
          created_at: new Date().toISOString(),
        };
        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: [...(prev[chatId] ?? []), userMsg],
        }));
        messagesRef.current = {
          ...messagesRef.current,
          [chatId]: [...(messagesRef.current[chatId] ?? []), userMsg],
        };
        await supabase.insert(token, "messages", [toRow(userMsg)]);

        await runCompletion(chatId);
      } catch (e: any) {
        setError(e?.message || String(e));
        setStreaming(IDLE_STREAMING);
      }
    },
    [runCompletion, streaming.active]
  );

  // ---------- Edit pesan (truncate + resend) ----------
  async function editMessage(id: string, newText: string) {
    const token = tokenRef.current;
    const chatId = activeChatRef.current;
    if (!token || !chatId || streaming.active) return;

    const list = messagesRef.current[chatId] ?? [];
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return;

    const edited: ChatMessage = { ...list[idx], content: [{ type: "text", text: newText }], attachments: [] };
    const remaining = [...list.slice(0, idx), edited];
    setMessagesByChat((prev) => ({ ...prev, [chatId]: remaining }));
    messagesRef.current = { ...messagesRef.current, [chatId]: remaining };

    try {
      await supabase.update(token, "messages", `id=eq.${id}`, {
        content: [{ type: "text", text: newText }],
        attachments: [],
      });
      const after = list.slice(idx + 1);
      if (after.length) {
        await supabase.delete(
          token,
          "messages",
          `id=in.(${after.map((m) => m.id).join(",")})`
        );
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      return;
    }
    await runCompletion(chatId);
  }

  // ---------- Delete pesan (pesan itu + semua setelahnya) ----------
  async function deleteMessage(id: string) {
    const token = tokenRef.current;
    const chatId = activeChatRef.current;
    if (!token || !chatId) return;

    const list = messagesRef.current[chatId] ?? [];
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return;

    const removed = list.slice(idx);
    const remaining = list.slice(0, idx);
    setMessagesByChat((prev) => ({ ...prev, [chatId]: remaining }));
    messagesRef.current = { ...messagesRef.current, [chatId]: remaining };

    try {
      await supabase.delete(
        token,
        "messages",
        `id=in.(${removed.map((m) => m.id).join(",")})`
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  // ---------- Regenerate jawaban terakhir ----------
  async function regenerate() {
    const token = tokenRef.current;
    const chatId = activeChatRef.current;
    if (!token || !chatId || streaming.active) return;

    const list = messagesRef.current[chatId] ?? [];
    const last = list[list.length - 1];
    if (!last || last.role !== "assistant") return;

    const remaining = list.slice(0, -1);
    setMessagesByChat((prev) => ({ ...prev, [chatId]: remaining }));
    messagesRef.current = { ...messagesRef.current, [chatId]: remaining };

    try {
      await supabase.delete(token, "messages", `id=eq.${last.id}`);
    } catch (e: any) {
      setError(e?.message || String(e));
      return;
    }
    await runCompletion(chatId);
  }

  // ---------- Manajemen chat ----------
  function newChat() {
    setActiveChatId(null);
    activeChatRef.current = null;
    setError(null);
  }

  async function selectChat(id: string) {
    if (streaming.active) return;
    setActiveChatId(id);
    activeChatRef.current = id;
    setError(null);
    if (!messagesRef.current[id] && tokenRef.current) {
      try {
        const rows = await supabase.select(
          tokenRef.current,
          "messages",
          `chat_id=eq.${id}&order=created_at.asc&select=*`
        );
        setMessagesByChat((prev) => ({ ...prev, [id]: Array.isArray(rows) ? rows : [] }));
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    }
  }

  async function deleteChat(id: string) {
    if (!tokenRef.current) return;
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeChatRef.current === id) newChat();
    try {
      await supabase.delete(tokenRef.current, "chats", `id=eq.${id}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  // ---------- Settings & memory ----------
  async function saveProfile(patch: Partial<Profile>) {
    if (!tokenRef.current || !profileRef.current) return;
    const next = { ...profileRef.current, ...patch };
    setProfile(next);
    profileRef.current = next;
    try {
      await supabase.update(
        tokenRef.current,
        "profiles",
        `user_id=eq.${userRef.current?.id}`,
        patch
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function refreshMemory(silent = false) {
    const token = tokenRef.current;
    const p = profileRef.current;
    if (!token || !p) return;
    if (!silent) setMemoryBusy(true);
    try {
      // Ambil semua pesan semua chat (terbaru dulu), group per chat
      const msgRows = await supabase.select(
        token,
        "messages",
        "select=chat_id,role,content,created_at&order=created_at.desc&limit=2000"
      );
      const chatRows = chatsRef.current;
      const byChat = new Map<string, { title: string; messages: { role: string; text: string }[] }>();
      for (const row of msgRows ?? []) {
        const text = (row.content ?? [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        if (!text) continue;
        if (!byChat.has(row.chat_id)) {
          const chat = chatRows.find((c: any) => c.id === row.chat_id);
          byChat.set(row.chat_id, { title: chat?.title ?? "Chat", messages: [] });
        }
        byChat.get(row.chat_id)!.messages.push({ role: row.role, text });
      }
      const chatsPayload = [...byChat.values()].map((c) => ({
        ...c,
        messages: c.messages.reverse(),
      }));

      const res = await fetch("/api/memory/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: { baseUrl: p.base_url, apiKey: p.api_key, model: p.model },
          currentMemory: {
            summary: memoryRef.current?.summary ?? "",
            facts: memoryRef.current?.facts ?? [],
          },
          chats: chatsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal refresh memory");

      const next: MemoryData = {
        user_id: userRef.current?.id,
        summary: data.summary ?? "",
        facts: data.facts ?? [],
        updated_at: new Date().toISOString(),
      };
      setMemory(next);
      memoryRef.current = next;

      // Upsert ke Supabase
      const existing = await supabase.select(
        token,
        "global_memory",
        `user_id=eq.${userRef.current?.id}&select=user_id`
      );
      if (Array.isArray(existing) && existing.length) {
        await supabase.update(
          token,
          "global_memory",
          `user_id=eq.${userRef.current?.id}`,
          { summary: next.summary, facts: next.facts, updated_at: next.updated_at }
        );
      } else {
        await supabase.insert(token, "global_memory", [
          {
            user_id: userRef.current?.id,
            summary: next.summary,
            facts: next.facts,
            updated_at: next.updated_at,
          },
        ]);
      }
      if (!silent) setError(null);
    } catch (e: any) {
      if (!silent) setError(e?.message || String(e));
    } finally {
      setMemoryBusy(false);
    }
  }

  return {
    ready,
    user,
    profile,
    memory,
    chats,
    activeChatId,
    messages,
    streaming,
    error,
    settingsOpen,
    memoryBusy,
    setError,
    setSettingsOpen,
    handleAuth,
    logout,
    sendMessage,
    stopStreaming,
    editMessage,
    deleteMessage,
    regenerate,
    newChat,
    selectChat,
    deleteChat,
    saveProfile,
    refreshMemory,
  };
}

function archiveToText(arc: ArchiveInspection): string {
  const lines = [
    `Isi arsip RAR "${arc.filename}":`,
    ...arc.files.map(
      (f) => `- ${f.name} (${f.size} bytes${f.isText ? "" : ", biner — tidak diekstrak"})`
    ),
  ];
  const texts = arc.files.filter((f) => f.isText && f.content);
  for (const f of texts) {
    lines.push(`\n--- ${f.name} ---\n${f.content}`);
  }
  return lines.join("\n");
}
