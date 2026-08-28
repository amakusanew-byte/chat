import { useState } from "react";
import { supabase } from "../api/supabase";

export default function AuthGate({ onAuth }: { onAuth: (user: any, token: string) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let token: string | undefined;
      let user: any = null;
      if (mode === "login") {
        const res = await supabase.signIn(email, password);
        token = res.access_token;
        user = res.user;
      } else {
        const res = await supabase.signUp(email, password);
        token = res.session?.access_token ?? res.access_token;
        user = res.user;
      }
      if (!token) {
        throw new Error("Verifikasi email dulu (kalau aktif), lalu login.");
      }
      if (!user) user = await supabase.getUser(token);
      onAuth(user, token);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>AI Chat</h1>
        <p className="auth-sub">{mode === "login" ? "Masuk ke akunmu" : "Buat akun baru"}</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kamu@email.com"
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="minimal 6 karakter"
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Tunggu…" : mode === "login" ? "Masuk" : "Daftar"}
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </form>
    </div>
  );
}
