import type { ChatMessage, StreamingState } from "../types";
import MessageList from "./MessageList";
import Composer from "./Composer";
import type { ArchiveInspection } from "../useChatApp";

interface Props {
  messages: ChatMessage[];
  streaming: StreamingState;
  chatTitle: string;
  onSend: (text: string, images: File[], archives: ArchiveInspection[]) => void;
  onStop: () => void;
  onEdit: (id: string, newText: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: () => void;
}

export default function ChatView({
  messages,
  streaming,
  chatTitle,
  onSend,
  onStop,
  onEdit,
  onDelete,
  onRegenerate,
}: Props) {
  return (
    <main className="chat-view">
      <div className="chat-head">
        <span className="chat-head-title">{chatTitle || "Chat baru"}</span>
      </div>
      <MessageList
        messages={messages}
        streaming={streaming}
        busy={streaming.active}
        onEdit={onEdit}
        onDelete={onDelete}
        onRegenerate={onRegenerate}
      />
      <Composer streaming={streaming} onSend={onSend} onStop={onStop} onError={() => {}} />
    </main>
  );
}
