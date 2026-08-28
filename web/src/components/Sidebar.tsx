import type { Chat, Profile } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  chats: Chat[];
  activeChatId: string | null;
  user: any;
  memoryEnabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleMemory: (v: boolean) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export default function Sidebar({
  open,
  onClose,
  chats,
  activeChatId,
  user,
  memoryEnabled,
  onSelect,
  onNew,
  onDelete,
  onToggleMemory,
  onOpenSettings,
  onLogout,
}: Props) {
  return (
    <>
      {/* Overlay drawer — hanya tampil di layar sempit (lihat styles.css) */}
      <div
        className={`sidebar-overlay ${open ? "show" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-top">
        <div className="brand">✦ AI Chat</div>
        <button className="btn-new-chat" onClick={onNew}>
          ＋ Chat baru
        </button>
      </div>

      <nav className="chat-list">
        {chats.length === 0 && <div className="chat-empty">Belum ada chat</div>}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`chat-item ${c.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="chat-title" title={c.title}>
              {c.title}
            </span>
            <button
              className="chat-delete"
              title="Hapus chat"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              🗑
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <label className="toggle-row" title="Gabungkan memori semua chat">
          <span>🧠 Memory semua chat</span>
          <input
            type="checkbox"
            checked={memoryEnabled}
            onChange={(e) => onToggleMemory(e.target.checked)}
          />
        </label>
        <button className="sidebar-btn" onClick={onOpenSettings}>
          ⚙️ Settings
        </button>
        <div className="user-row">
          <span className="user-email" title={user?.email}>
            {user?.email ?? "user"}
          </span>
          <button className="btn-link" onClick={onLogout}>
            Keluar
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
