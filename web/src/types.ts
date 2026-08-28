// Tipe bersama frontend.

export interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: any;
  source?: { type: string; media_type: string; data: string };
}

// File hasil generate AI (content = base64)
export interface FileAttachment {
  id?: string;
  filename: string;
  mime?: string;
  content: string;
}

// Metadata arsip RAR yang di-upload user
export interface ArchiveAttachment {
  type: "archive";
  filename: string;
  files: { name: string; size: number; isText: boolean }[];
}

export type Attachment = FileAttachment | ArchiveAttachment;

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: Block[];
  attachments: Attachment[];
  created_at: string;
}

export interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  display_name?: string;
  system_prompt: string;
  extra_instructions: string;
  provider_name: string;
  base_url: string;
  model: string;
  api_key: string;
  memory_enabled: boolean;
}

export interface MemoryData {
  user_id?: string;
  summary: string;
  facts: { fact: string; chat_id?: string }[];
  updated_at?: string;
}

export interface StreamingState {
  active: boolean;
  phase: "connecting" | "thinking" | "browsing" | "writing" | "generating_file" | "";
  thinking: string;
  text: string;
  files: FileAttachment[];
}

export const PHASE_LABELS: Record<string, string> = {
  connecting: "Menyambungkan…",
  thinking: "Thinking…",
  browsing: "Browsing…",
  writing: "Menulis…",
  generating_file: "Generating file…",
};

// Provider default sesuai ai.txt — dipakai saat profil pertama kali dibuat
export const DEFAULT_PROVIDER = {
  provider_name: "GoRouter",
  base_url: "https://gorouter.lived.workers.dev",
  model: "claude-opus-5-thinking",
  api_key: "sk-9HIKKyg8F1yLn5KjHfzzCqasVOo4G0s9OMPbXx6FxH2VtXHc",
};
