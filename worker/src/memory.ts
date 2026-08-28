// Refresh memori global: gabungkan memori lama + transkrip chat menjadi
// ringkasan dan daftar fakta (disimpan client di tabel global_memory).

import { callUpstream, requestVariants } from "./anthropic";

export interface MemoryInput {
  provider: { baseUrl: string; apiKey: string; model: string };
  currentMemory: { summary: string; facts: any[] };
  chats: { title: string; messages: { role: string; text: string }[] }[];
}

const TOTAL_CHAR_BUDGET = 400_000;

export async function refreshMemory(input: MemoryInput): Promise<{ summary: string; facts: any[] }> {
  // Chat terbaru dulu (client mengirim urut terbaru -> lama)
  let budget = TOTAL_CHAR_BUDGET;
  const parts: string[] = [];
  for (const chat of input.chats) {
    if (budget <= 0) break;
    const lines = chat.messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");
    const block = `## Chat: ${chat.title}\n${lines}`;
    if (block.length > budget) {
      parts.push(block.slice(0, budget));
      budget = 0;
      break;
    }
    budget -= block.length;
    parts.push(block);
  }

  const system =
    "You maintain the long-term memory of an AI assistant. Merge the existing memory with the new " +
    "conversation transcripts into an updated memory. Keep the most important, durable facts about the " +
    "user (preferences, projects, goals, personal details they shared). Drop stale or contradicted facts. " +
    "Respond with JSON only, no markdown fences: {\"summary\": \"<narrative summary under 600 words>\", " +
    "\"facts\": [\"<short fact>\", ...]}";

  const user =
    `Current memory:\n${JSON.stringify({
      summary: input.currentMemory?.summary ?? "",
      facts: (input.currentMemory?.facts ?? []).map((f: any) => f.fact ?? f),
    })}\n\nNew conversations:\n${parts.join("\n\n")}\n\n` +
    "Return the updated memory as JSON only.";

  const body: any = {
    model: input.provider.model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  };

  let data: any = null;
  for (const variant of requestVariants(input.provider, body)) {
    const res = await callUpstream(input.provider, variant);
    if (res.ok) {
      data = await res.json();
      break;
    }
    if (res.status !== 400) {
      throw new Error(`Upstream ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    // 400 -> coba varian berikutnya (tanpa thinking / tanpa tools)
  }
  if (!data) throw new Error("Gagal memperbarui memori (upstream menolak semua varian request).");

  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  const parsed = extractJson(text);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    facts: Array.isArray(parsed.facts)
      ? parsed.facts.map((f: any) => (typeof f === "string" ? { fact: f } : f)).filter(Boolean)
      : [],
  };
}

function extractJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}
