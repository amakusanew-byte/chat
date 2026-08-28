import { useEffect, useRef } from "react";
import type { ChatMessage, StreamingState } from "../types";
import Message from "./Message";
import ThinkingBlock from "./ThinkingBlock";
import MarkdownBody from "./MarkdownBody";
import FileCard from "./FileCard";

interface Props {
  messages: ChatMessage[];
  streaming: StreamingState;
  busy: boolean;
  onEdit: (id: string, newText: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: () => void;
}

export default function MessageList({ messages, streaming, busy, onEdit, onDelete, onRegenerate }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming.text, streaming.thinking, streaming.files.length]);

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div className="message-list">
      {messages.map((m, i) => (
        <Message
          key={m.id}
          message={m}
          isLast={i === lastAssistantIdx}
          busy={busy}
          onEdit={onEdit}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
        />
      ))}

      {streaming.active && (
        <div className="msg assistant">
          <div className="msg-avatar">✦</div>
          <div className="msg-body">
            {streaming.thinking && <ThinkingBlock thinking={streaming.thinking} live />}
            {streaming.files.map((f, i) => (
              <FileCard key={f.id ?? i} filename={f.filename} mime={f.mime} content={f.content} />
            ))}
            {streaming.text && <MarkdownBody text={streaming.text} />}
            {!streaming.text && !streaming.thinking && !streaming.files.length && (
              <div className="dot-loader">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
