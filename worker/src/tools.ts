// Definisi & eksekusi tool yang bisa dipakai AI.
// create_file: AI membuat file ekstensi apa pun yang bisa di-download user.

import type { ClientEvent, ToolResult } from "./anthropic";

export const TOOLS = [
  {
    name: "create_file",
    description:
      "Create a file of any type/extension and deliver it to the user in chat so they can download it. " +
      "Use content_text for text files (code, markdown, CSV, config, etc.) and content_base64 for binary files. " +
      "Always use a meaningful filename with the correct extension.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name including extension, e.g. script.py" },
        mime_type: { type: "string", description: "Optional MIME type, e.g. text/x-python" },
        content_text: { type: "string", description: "Plain-text file content (preferred for text files)" },
        content_base64: { type: "string", description: "Base64-encoded binary content (for non-text files)" },
      },
      required: ["filename"],
      additionalProperties: false,
    },
  },
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop()!.replace(/[^\w.\-() ]+/g, "_");
  return base || "file";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv",
    html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
    ts: "text/typescript", jsx: "text/javascript", tsx: "text/typescript",
    py: "text/x-python", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    zip: "application/zip", rar: "application/vnd.rar", xml: "application/xml",
    yml: "text/yaml", yaml: "text/yaml", log: "text/plain", sql: "application/sql",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function executeTool(toolUse: any, onEvent: (ev: ClientEvent) => void): Promise<ToolResult> {
  if (toolUse.name !== "create_file") {
    return { content: `Unknown tool: ${toolUse.name}`, isError: true };
  }
  const input = toolUse.input ?? {};
  const filename = sanitizeFilename(input.filename);
  let b64: string | undefined =
    typeof input.content_base64 === "string" && input.content_base64.trim() ? input.content_base64.trim() : undefined;
  if (!b64 && typeof input.content_text === "string") {
    b64 = bytesToB64(new TextEncoder().encode(input.content_text));
  }
  if (!b64) {
    return { content: "Error: provide content_text or content_base64.", isError: true };
  }

  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(b64);
  } catch {
    return { content: "Error: content_base64 is not valid base64.", isError: true };
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return {
      content: `Error: file too large (${bytes.length} bytes, max ${MAX_FILE_BYTES}).`,
      isError: true,
    };
  }

  const mime =
    typeof input.mime_type === "string" && input.mime_type ? input.mime_type : guessMime(filename);
  const id = crypto.randomUUID();
  onEvent({ type: "file", filename, mime, content: b64, id });
  return {
    content: `File "${filename}" (${bytes.length} bytes) was created and delivered to the user.`,
    attachment: { id, filename, mime, content: b64 },
  };
}
