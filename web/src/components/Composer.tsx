import { useEffect, useRef, useState } from "react";
import type { StreamingState } from "../types";
import { PHASE_LABELS } from "../types";
import type { ArchiveInspection } from "../useChatApp";

interface Props {
  streaming: StreamingState;
  onSend: (text: string, images: File[], archives: ArchiveInspection[]) => void;
  onStop: () => void;
  onError: (msg: string) => void;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function Composer({ streaming, onSend, onStop, onError }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [archives, setArchives] = useState<ArchiveInspection[]>([]);
  const [archiving, setArchiving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const rarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [text]);

  function pickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].filter(
      (f) => f.type.startsWith("image/") && f.size <= MAX_IMAGE_BYTES
    );
    if (files.length) setImages((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  async function pickRar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setArchiving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/archive/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal membaca arsip");
      setArchives((prev) => [...prev, { filename: data.filename, files: data.files }]);
    } catch (err: any) {
      onError(err?.message || String(err));
    } finally {
      setArchiving(false);
    }
  }

  function submit() {
    if (streaming.active) return;
    if (!text.trim() && !images.length && !archives.length) return;
    onSend(text, images, archives);
    setText("");
    setImages([]);
    setArchives([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer-wrap">
      {streaming.active && (
        <div className="status-indicator">
          <span className="pulse-dot" />
          {PHASE_LABELS[streaming.phase] ?? "Menyambungkan…"}
        </div>
      )}
      <div className="composer">
        {(images.length > 0 || archives.length > 0 || archiving) && (
          <div className="pending-attachments">
            {images.map((f, i) => (
              <span key={i} className="chip">
                🖼 {f.name}
                <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {archives.map((a, i) => (
              <span key={i} className="chip">
                🗜 {a.filename} ({a.files.length})
                <button onClick={() => setArchives((p) => p.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {archiving && <span className="chip">Membaca arsip…</span>}
          </div>
        )}
        <div className="composer-row">
          <button
            className="attach-btn"
            title="Lampirkan gambar"
            onClick={() => imgInputRef.current?.click()}
            disabled={streaming.active}
          >
            🖼
          </button>
          <button
            className="attach-btn"
            title="Lampirkan file RAR"
            onClick={() => rarInputRef.current?.click()}
            disabled={streaming.active}
          >
            🗜
          </button>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ketik pesan… (Enter kirim, Shift+Enter baris baru)"
            rows={1}
            disabled={streaming.active}
          />
          {streaming.active ? (
            <button className="send-btn stop" onClick={onStop} title="Stop">
              ■
            </button>
          ) : (
            <button className="send-btn" onClick={submit} title="Kirim" disabled={!text.trim() && !images.length && !archives.length}>
              ➤
            </button>
          )}
        </div>
        <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={pickImages} />
        <input ref={rarInputRef} type="file" accept=".rar" hidden onChange={pickRar} />
      </div>
    </div>
  );
}
