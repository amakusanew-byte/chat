import { useState } from "react";
import type { ArchiveAttachment } from "../types";
import { formatBytes } from "../utils";

export default function ArchiveCard({ archive }: { archive: ArchiveAttachment }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="archive-card">
      <button className="archive-head" onClick={() => setOpen(!open)}>
        <span>🗜️</span>
        <span className="archive-name">{archive.filename}</span>
        <span className="archive-count">{archive.files.length} file</span>
        <span className="archive-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="archive-list">
          {archive.files.map((f) => (
            <li key={f.name} className={f.isText ? "" : "binary"}>
              <span className="archive-file-name">{f.name}</span>
              <span className="archive-file-size">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
