// Konsumen SSE untuk POST /api/chat.

import type { FileAttachment } from "../types";

export interface StreamHandlers {
  onStatus?: (phase: string) => void;
  onThinkingDelta: (text: string) => void;
  onTextDelta: (text: string) => void;
  onFile: (file: FileAttachment) => void;
  onDone: (data: any) => void;
  onError: (message: string) => void;
}

export async function streamChat(
  payload: any,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = await res.text().catch(() => "");
    try {
      const j = JSON.parse(msg);
      msg = j.error || msg;
    } catch {}
    handlers.onError(msg || `${res.status} ${res.statusText}`);
    return;
  }

  const reader = res.body.getReader();
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
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) data += line.slice(5);
      }
      if (!data.trim()) continue;
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case "status":
          handlers.onStatus?.(ev.phase);
          break;
        case "thinking":
          handlers.onThinkingDelta(ev.text ?? "");
          break;
        case "text":
          handlers.onTextDelta(ev.text ?? "");
          break;
        case "file":
          handlers.onFile(ev as FileAttachment);
          break;
        case "done":
          handlers.onDone(ev);
          break;
        case "error":
          handlers.onError(ev.message ?? "Unknown error");
          break;
      }
    }
  }
}
