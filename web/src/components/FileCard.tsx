import { useEffect, useMemo } from "react";
import { b64ToBlobUrl, formatBytes } from "../utils";

export default function FileCard({
  filename,
  mime,
  content,
}: {
  filename: string;
  mime?: string;
  content: string;
}) {
  const url = useMemo(() => b64ToBlobUrl(content, mime), [content, mime]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  if (!url) return null;
  return (
    <a className="file-card" href={url} download={filename}>
      <span className="file-icon">📄</span>
      <span className="file-info">
        <span className="file-name">{filename}</span>
        <span className="file-meta">{mime || "file"}</span>
      </span>
      <span className="file-dl" title={formatBytes(atob(content).length)}>⬇ Download</span>
    </a>
  );
}
