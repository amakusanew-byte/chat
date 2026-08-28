// Klien Anthropic Messages API: streaming SSE + tool-use loop.
// Dibuat manual dengan fetch (tanpa SDK) agar bundle Worker tetap ringan.

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ClientEvent {
  type: "status" | "thinking" | "text" | "file" | "done" | "error";
  [key: string]: any;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  attachment?: any;
}

export interface RunChatOptions {
  provider: ProviderConfig;
  system: string;
  messages: any[];
  tools?: any[];
  onEvent: (ev: ClientEvent) => void;
  executeTool: (toolUse: any, onEvent: (ev: ClientEvent) => void) => Promise<ToolResult>;
}

const MAX_TOOL_ITERATIONS = 8;

function endpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/v1/messages";
}

function wantsThinking(model: string): boolean {
  return /thinking/i.test(model);
}

export async function callUpstream(provider: ProviderConfig, body: any): Promise<Response> {
  return fetch(endpoint(provider.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      authorization: `Bearer ${provider.apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
}

// Tangga fallback agar kompatibel dengan Anthropic resmi maupun router pihak ketiga:
// adaptive thinking -> budget_tokens -> tanpa thinking -> tanpa tools
export function requestVariants(provider: ProviderConfig, base: any): any[] {
  const variants: any[] = [];
  if (wantsThinking(provider.model)) {
    variants.push({ ...base, thinking: { type: "adaptive", display: "summarized" } });
    variants.push({ ...base, thinking: { type: "enabled", budget_tokens: 10000 } });
  }
  variants.push({ ...base });
  if (base.tools?.length) variants.push({ ...base, tools: undefined });
  return variants;
}

// Coba tiap varian; varian berikutnya hanya dicoba kalau error 400
// terlihat berkaitan dengan thinking atau tools.
async function openStream(provider: ProviderConfig, body: any): Promise<Response> {
  const variants = requestVariants(provider, body);
  let last: Response | null = null;
  for (const variant of variants) {
    const res = await callUpstream(provider, variant);
    if (res.ok) return res;
    last = res;
    if (res.status === 400 && variants.length > 1) {
      const text = await res.clone().text();
      if (/thinking|budget|adaptive|tool/i.test(text)) continue;
    }
    return res;
  }
  return last!;
}

// Parser SSE: pecah buffer per blok "\n\n", gabung baris "data:", JSON.parse.
async function* parseSSE(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) yield ev;
    }
  }
  if (buf.trim()) {
    const ev = parseBlock(buf);
    if (ev) yield ev;
  }
}

function parseBlock(block: string): any | null {
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data += line.slice(5);
  }
  if (!data.trim()) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function runChat(opts: RunChatOptions): Promise<{
  content: any[];
  attachments: any[];
  stopReason: string;
  usage: any;
}> {
  const { provider, system, messages, tools, onEvent, executeTool } = opts;
  let conversation = [...messages];
  const allBlocks: any[] = [];
  const attachments: any[] = [];
  let usage: any = {};

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const body: any = {
      model: provider.model,
      max_tokens: 16000,
      stream: true,
      messages: conversation,
    };
    if (system) body.system = system;
    if (tools?.length) body.tools = tools;

    const res = await openStream(provider, body);
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${text.slice(0, 500)}`);
    }

    const blocks: any[] = [];
    let current: any = null;
    let stopReason = "end_turn";

    for await (const ev of parseSSE(res)) {
      switch (ev.type) {
        case "message_start":
          if (ev.message?.usage) usage = { ...usage, ...ev.message.usage };
          break;
        case "content_block_start": {
          const cb = ev.content_block ?? {};
          current = cb.type === "tool_use" ? { ...cb, inputJson: "" } : { ...cb };
          blocks.push(current);
          if (cb.type === "tool_use" && cb.name === "create_file") {
            onEvent({ type: "status", phase: "generating_file" });
          }
          break;
        }
        case "content_block_delta": {
          const d = ev.delta ?? {};
          if (!current) break;
          if (d.type === "thinking_delta") {
            current.thinking = (current.thinking ?? "") + d.thinking;
            onEvent({ type: "thinking", text: d.thinking });
          } else if (d.type === "text_delta") {
            current.text = (current.text ?? "") + d.text;
            onEvent({ type: "text", text: d.text });
          } else if (d.type === "input_json_delta") {
            current.inputJson = (current.inputJson ?? "") + d.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          if (current?.type === "tool_use") {
            try {
              current.input = JSON.parse(current.inputJson || "{}");
            } catch {
              current.input = {};
            }
          }
          if (current) delete current.inputJson;
          current = null;
          break;
        }
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.usage) usage = { ...usage, ...ev.usage };
          break;
        case "error":
          throw new Error(ev.error?.message || "Upstream stream error");
      }
    }

    // Buang block kosong (mis. thinking "omitted" menghasilkan teks kosong)
    const cleaned = blocks.filter(
      (b) =>
        (b.type === "text" && b.text) ||
        (b.type === "thinking" && b.thinking) ||
        b.type === "tool_use"
    );

    const toolUses = cleaned.filter((b) => b.type === "tool_use");
    allBlocks.push(...cleaned);

    if (stopReason !== "tool_use" || !toolUses.length || !tools?.length) {
      return { content: allBlocks, attachments, stopReason, usage };
    }

    // Jalankan semua tool; hasilnya dikirim dalam SATU pesan user
    const toolResults = [];
    for (const tu of toolUses) {
      let result: ToolResult;
      try {
        result = await executeTool(tu, onEvent);
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

    // Thinking block di-echo verbatim — disyaratkan saat continuasi
    // pada model yang sama dengan thinking aktif.
    conversation = [
      ...conversation,
      { role: "assistant", content: cleaned },
      { role: "user", content: toolResults },
    ];
  }

  return { content: allBlocks, attachments, stopReason: "max_tool_iterations", usage };
}
