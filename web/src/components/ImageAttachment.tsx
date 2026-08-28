import { useState } from "react";
import type { Block } from "../types";

export default function ImageAttachment({ block }: { block: Block }) {
  const [zoom, setZoom] = useState(false);
  if (!block.source) return null;
  const src = `data:${block.source.media_type};base64,${block.source.data}`;
  return (
    <>
      <img
        className="chat-image"
        src={src}
        alt="lampiran gambar"
        onClick={() => setZoom(true)}
      />
      {zoom && (
        <div className="image-zoom" onClick={() => setZoom(false)}>
          <img src={src} alt="lampiran gambar" />
        </div>
      )}
    </>
  );
}
