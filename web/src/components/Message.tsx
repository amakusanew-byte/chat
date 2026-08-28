import { useState } from "react";
import type { ChatMessage } from "../types";
import MarkdownBody from "./MarkdownBody";
import ThinkingBlock from "./ThinkingBlock";
import ImageAttachment from "./ImageAttachment";
import FileCard from "./FileCard";
import ArchiveCard from "./ArchiveCard";

interface Props {
  message: ChatMessage;
  isLast: boolean;
  busy: boolean;
  onEdit: (id: string, newText: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: () => void;
}

export default function Message({ message, isLast, busy, onEdit, onDelete, onRegenerate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const isUser = message.role === "user";

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const thinking = message.content
    .filter((b) => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n");
  const images = message.content.filter((b) => b.type === "image");
  const archives = (message.attachments ?? []).filter(
    (a): a is Extract<typeof a, { type: "archive" }> => a?.type === "archive"
  );
  const files = (message.attachments ?? []).filter(
    (a) => a && a.type !== "archive" && "content" in a
  ) as { id?: string; filename: string; mime?: string; content: string }[];

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }

  async function saveEdit() {
    setEditing(false);
    onEdit(message.id, draft);
  }

  function copy() {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      <div className="msg-avatar">{isUser ? "🧑" : "✦"}</div>
      <div className="msg-body">
        {!isUser && thinking && <ThinkingBlock thinking={thinking} />}
        {images.map((b, i) => (
          <ImageAttachment key={i} block={b} />
        ))}
        {archives.map((a, i) => (
          <ArchiveCard key={i} archive={a} />
        ))}
        {editing ? (
          <div className="edit-box">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, Math.max(3, draft.split("\n").length + 1))}
              autoFocus
            />
            <div className="edit-actions">
              <button className="btn-primary btn-sm" onClick={saveEdit} disabled={busy}>
                Simpan & kirim ulang
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Batal
              </button>
            </div>
          </div>
        ) : (
          text && <MarkdownBody text={text} />
        )}
        {files.map((f, i) => (
          <FileCard key={f.id ?? i} filename={f.filename} mime={f.mime} content={f.content} />
        ))}
        {!editing && (
          <div className="msg-actions">
            <button title="Copy" onClick={copy}>
              ⧉
            </button>
            {isUser && (
              <button title="Edit pesan" onClick={startEdit} disabled={busy}>
                ✎
              </button>
            )}
            {!isUser && isLast && (
              <button title="Regenerate" onClick={onRegenerate} disabled={busy}>
                ↻
              </button>
            )}
            <button
              title="Hapus pesan (beserta pesan setelahnya)"
              onClick={() => onDelete(message.id)}
              disabled={busy}
            >
              🗑
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
