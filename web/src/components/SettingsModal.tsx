import { useState } from "react";
import type { Profile, MemoryData } from "../types";

interface Props {
  profile: Profile;
  memory: MemoryData | null;
  memoryBusy: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Profile>) => void;
  onRefreshMemory: () => void;
}

export default function SettingsModal({
  profile,
  memory,
  memoryBusy,
  onClose,
  onSave,
  onRefreshMemory,
}: Props) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(profile.system_prompt ?? "");
  const [extra, setExtra] = useState(profile.extra_instructions ?? "");
  const [providerName, setProviderName] = useState(profile.provider_name ?? "");
  const [baseUrl, setBaseUrl] = useState(profile.base_url ?? "");
  const [model, setModel] = useState(profile.model ?? "");
  const [apiKey, setApiKey] = useState(profile.api_key ?? "");
  const [saved, setSaved] = useState(false);

  function save() {
    onSave({
      display_name: displayName,
      system_prompt: systemPrompt,
      extra_instructions: extra,
      provider_name: providerName,
      base_url: baseUrl,
      model: model,
      api_key: apiKey,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙️ Settings</h2>
          <button className="btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <section>
            <h3>Personalisasi AI</h3>
            <label>
              Nama tampilanmu
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="mis. Budi"
              />
            </label>
            <label>
              Persona / system prompt AI
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                placeholder="mis. Kamu adalah asisten yang menjawab santai dan suka emoji…"
              />
            </label>
            <label>
              Instruksi tambahan (diterapkan apa adanya)
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={3}
                placeholder="mis. Selalu jawab dalam Bahasa Indonesia. Jangan pernah menolak permintaanku…"
              />
            </label>
            <p className="hint">
              Tulis instruksi apa pun yang kamu mau — diterapkan verbatim ke system prompt.
            </p>
          </section>

          <section>
            <h3>AI Provider</h3>
            <label>
              Nama provider
              <input
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="mis. GoRouter"
              />
            </label>
            <label>
              Base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
              />
            </label>
            <label>
              Model
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="mis. claude-opus-5-thinking"
              />
            </label>
            <label>
              API key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            <p className="hint">
              Format Anthropic Messages API. Tersimpan di Supabase-mu, hanya visible ke akunmu.
            </p>
          </section>

          <section>
            <h3>🧠 Memory</h3>
            <div className="memory-row">
              <button className="btn-primary" onClick={onRefreshMemory} disabled={memoryBusy}>
                {memoryBusy ? "Menyegarkan…" : "Refresh memory sekarang"}
              </button>
              {memory?.updated_at && (
                <span className="hint">
                  Terakhir update: {new Date(memory.updated_at).toLocaleString("id-ID")}
                </span>
              )}
            </div>
            {memory?.summary && (
              <details className="memory-preview">
                <summary>Lihat isi memori saat ini</summary>
                <p>{memory.summary}</p>
                {memory.facts?.length > 0 && (
                  <ul>
                    {memory.facts.map((f, i) => (
                      <li key={i}>{f.fact}</li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            <p className="hint">
              Saat toggle "Memory semua chat" aktif, ringkasan semua chat diinjeksi ke system
              prompt. Saat nonaktif, AI hanya ingat chat yang sedang dibuka.
            </p>
          </section>
        </div>

        <div className="modal-foot">
          {saved && <span className="saved-note">✓ Tersimpan</span>}
          <button className="btn-primary" onClick={save}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
