import { useState } from "react";
import { supabaseConfigured } from "./api/supabase";
import { useChatApp } from "./useChatApp";
import AuthGate from "./components/AuthGate";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SettingsModal from "./components/SettingsModal";

export default function App() {
  const app = useChatApp();
  // Drawer sidebar (mobile saja; di layar lebar sidebar selalu tampil)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!supabaseConfigured) {
    return (
      <div className="notice-wrap">
        <div className="notice">
          <h2>Konfigurasi belum lengkap</h2>
          <p>
            Buat file <code>web/.env</code> berisi <code>VITE_SUPABASE_URL</code> dan{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (lihat <code>web/.env.example</code>), lalu
            jalankan ulang dev server.
          </p>
        </div>
      </div>
    );
  }

  if (!app.ready) {
    return <div className="notice-wrap"><div className="notice">Memuat…</div></div>;
  }

  if (!app.user) {
    return <AuthGate onAuth={app.handleAuth} />;
  }

  const activeChat = app.chats.find((c) => c.id === app.activeChatId);

  return (
    <div className="shell">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chats={app.chats}
        activeChatId={app.activeChatId}
        user={app.user}
        memoryEnabled={!!app.profile?.memory_enabled}
        onSelect={(id) => {
          app.selectChat(id);
          setSidebarOpen(false);
        }}
        onNew={() => {
          app.newChat();
          setSidebarOpen(false);
        }}
        onDelete={app.deleteChat}
        onToggleMemory={(v) => app.saveProfile({ memory_enabled: v })}
        onOpenSettings={() => {
          app.setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        onLogout={app.logout}
      />
      <ChatView
        messages={app.messages}
        streaming={app.streaming}
        chatTitle={activeChat?.title ?? ""}
        onOpenSidebar={() => setSidebarOpen(true)}
        onSend={app.sendMessage}
        onStop={app.stopStreaming}
        onEdit={app.editMessage}
        onDelete={app.deleteMessage}
        onRegenerate={app.regenerate}
      />
      {app.error && (
        <div className="error-toast" onClick={() => app.setError(null)}>
          {app.error} <span className="dismiss">×</span>
        </div>
      )}
      {app.settingsOpen && app.profile && (
        <SettingsModal
          profile={app.profile}
          memory={app.memory}
          memoryBusy={app.memoryBusy}
          onClose={() => app.setSettingsOpen(false)}
          onSave={app.saveProfile}
          onRefreshMemory={() => app.refreshMemory()}
        />
      )}
    </div>
  );
}
