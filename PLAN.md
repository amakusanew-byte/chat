# PLAN.md — Aplikasi AI Chat Web (seperti ChatGPT / Perplexity)

> Dokumen lengkap rencana implementasi. **BELUM DIEKSEKUSI.** Dieksekusi phase demi phase, jangan lanjut phase berikut sebelum fase saat ini lolos verifikasi.

---

## 1. KONTEKS

Folder kerja: `C:\Users\ASUS.DESKTOP-KUMBO0D\Downloads\chat` — hanya berisi:
- `baca.txt` — spesifikasi fitur dari user
- `ai.txt` — contoh endpoint provider (sudah DIVERIFIKASI bekerja via curl)

Proyek dibangun **dari nol** (greenfield).

**Spesifikasi user (dari `baca.txt`):**
| # | Fitur |
|---|---|
| 1 | Indikator saat AI mikir: tulisan "thinking" / "browsing" / dll. |
| 2 | Edit message |
| 3 | Delete message |
| 4 | Next chat (chat baru / daftar chat) |
| 5 | AI bisa membuat file ekstensi APA PUN dan mengirimnya di chat, bisa di-download |
| 6 | Setting personalisasi AI |
| 7 | Setting AI gak boleh nolak |
| 8 | Vision: kalau model punya skill vision bisa lihat gambar |
| 9 | Upload & lihat gambar di chat |
| 10 | Bisa melihat RAR kalau user kirim RAR |
| 11 | Input AI provider (base URL, nama model, nama provider, API key) seperti Agen Hermes |
| 12 | HARUS RINGAN |
| 13 | Tools: Cloudflare, GitHub, Supabase |
| 14 | Memory: checked = semua chat digabung; unchecked = memory per chat masing-masing |

**Keputusan yang sudah disepakati dengan user:**
- Frontend: **React + Vite**
- Storage: **Supabase** (auth + Postgres)
- Deploy: **Cloudflare Workers**
- Format API AI: **Anthropic Messages API saja** (`/v1/messages`), model Claude saja (termasuk `-thinking`)
- Endpoint default dari `ai.txt`: base URL `https://gorouter.lived.workers.dev`, model `claude-opus-5-thinking`, API key sesuai `ai.txt` (dipakai sebagai prefill default profil)

**Hasil verifikasi endpoint (curl sukses):**
```
POST https://gorouter.lived.workers.dev/v1/messages
headers: x-api-key, anthropic-version: 2023-06-01
body: {"model":"claude-opus-5-thinking","max_tokens":50,"messages":[...]}
→ 200 OK, format respons Anthropic standar (content blocks, usage, dll.)
```

---

## 2. ARSITEKTUR

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Browser (React + Vite)     │  SSE    │  Cloudflare Worker           │
│                             │ ──────▶ │  /api/chat        (stream)   │
│  - UI chat, sidebar,        │         │  /api/archive/*   (RAR)      │
│    settings, auth           │         │  /api/memory/*    (refresh)  │
│  - CRUD langsung ke         │         │  - klien Anthropic (fetch)   │
│    Supabase via REST (RLS)  │         │  - tool-use loop             │
│  - persist pesan assistant  │         │  - kirim ke provider user    │
└──────────┬──────────────────┘         └──────────────┬───────────────┘
           │ REST (PostgREST + GoTrue)                 │ HTTPS
           ▼                                           ▼
   ┌───────────────┐                        ┌─────────────────────────┐
   │   Supabase    │                        │  Provider AI (Anthropic │
   │  auth + DB    │                        │  Messages API, base URL │
   │  (4 tabel+RLS)│                        │  dikonfigurasi user)    │
   └───────────────┘                        └─────────────────────────┘
```

**Prinsip kunci:**
- Worker **stateless** untuk chat: browser mengirim seluruh percakapan di body `POST /api/chat`; Worker tidak menyentuh Supabase di jalur hot (kecuali memory refresh).
- **Browser** yang menulis pesan (user & assistant) ke Supabase via PostgREST — RLS menjaga keamanan. Ini membuat edit/delete/regenerate trivial (truncate + resend).
- API key user dikirim per-request browser → Worker → provider. Tidak dipersist Worker.
- Satu deploy: Worker serve static assets (`web/dist`) + API → same-origin, tanpa masalah CORS.

---

## 3. STRUKTUR PROYEK (file lengkap)

```
chat/
├── PLAN.md                      ← dokumen ini
├── package.json                 ← npm workspaces: ["web", "worker"]
├── .gitignore
├── web/                         ← FRONTEND (Vite + React)
│   ├── package.json
│   ├── vite.config.ts           ← dev proxy /api → localhost:8787
│   ├── tsconfig.json
│   ├── index.html
│   ├── .env.example             ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              ← AuthGate ↔ Shell, routing view
│       ├── useChatApp.ts        ← hook pusat: state + semua aksi chat
│       ├── types.ts             ← tipe bersama + DEFAULT_PROVIDER
│       ├── utils.ts             ← base64/file/blob helpers, formatBytes
│       ├── api/
│       │   ├── supabase.ts      ← klien REST ringan (GoTrue + PostgREST)
│       │   └── chat.ts          ← konsumen SSE /api/chat
│       ├── components/
│       │   ├── AuthGate.tsx     ← login / signup
│       │   ├── Sidebar.tsx      ← daftar chat, chat baru, toggle memory, settings, logout
│       │   ├── ChatView.tsx     ← layout kolom chat
│       │   ├── MessageList.tsx  ← daftar pesan + auto-scroll
│       │   ├── Message.tsx      ← bubble pesan + tombol aksi + render block
│       │   ├── ThinkingBlock.tsx← panel "Thinking…" collapsible (live)
│       │   ├── MarkdownBody.tsx ← marked + DOMPurify
│       │   ├── ImageAttachment.tsx ← preview gambar + klik zoom
│       │   ├── FileCard.tsx     ← kartu file AI (Blob + a[download])
│       │   ├── ArchiveCard.tsx  ← kartu isi RAR
│       │   ├── EditComposer.tsx ← edit inline pesan user
│       │   ├── Composer.tsx     ← input + upload gambar/RAR + status indicator
│       │   └── SettingsModal.tsx← personalisasi + provider + memory
│       └── styles.css           ← satu file CSS, dark theme, CSS variables
└── worker/                      ← BACKEND (Cloudflare Worker)
    ├── package.json
    ├── wrangler.jsonc           ← assets ../web/dist, nodejs_compat
    ├── tsconfig.json
    └── src/
        ├── index.ts             ← Hono app: routing + SSE + fallback assets
        ├── anthropic.ts         ← parser SSE + klien streaming + tool loop
        ├── tools.ts             ← tool create_file (definisi + eksekutor)
        ├── rar.ts               ← inspeksi RAR (node-unrar-js dynamic import)
        └── memory.ts            ← refresh memori global
```

**Dependensi (minimalis — fitur #12 "HARUS RINGAN"):**

| Paket | Ukuran | Alasan |
|---|---|---|
| `react`, `react-dom` | ~45KB gz | framework pilihan user |
| `marked` + `dompurify` | ~15KB gz | markdown ringan (vs react-markdown ~45KB) |
| `hono` (worker) | ~15KB | routing ringan tanpa boilerplate |
| `node-unrar-js` (worker) | WASM | RAR — dynamic import, jalur terpisah |

**Sengaja TANPA:**
- ❌ `@supabase/supabase-js` (~40KB) → diganti klien fetch ~120 baris (`web/src/api/supabase.ts`)
- ❌ `@anthropic-ai/sdk` (~90KB) → diganti parser SSE manual (~200 baris di worker)
- ❌ Tailwind / UI kit / icon lib / date lib / state lib → CSS polos, SVG inline, `Intl.*`, `useReducer` + context

Target total bundle frontend: **< 100KB gzip**.

---

## 4. SKEMA SUPABASE (`supabase/schema.sql`)

```sql
create extension if not exists pgcrypto;

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text default '',
  system_prompt text default '',          -- fitur 6: personalisasi
  extra_instructions text default '',     -- fitur 7: instruksi bebas user
  provider_name text default 'GoRouter',  -- fitur 11
  base_url text default 'https://gorouter.lived.workers.dev',
  model text default 'claude-opus-5-thinking',
  api_key text default '',
  memory_enabled boolean default false,   -- fitur 14
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Chat baru',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,   -- block Anthropic: text/thinking/image/tool_use
  attachments jsonb default '[]',  -- file AI (fitur 5) + metadata RAR (fitur 10)
  created_at timestamptz default now()
);
create index on messages (chat_id, created_at);
create index on chats (user_id, updated_at desc);

create table global_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text default '',     -- ringkasan naratif ≤600 kata
  facts jsonb default '[]',    -- [{fact, chat_id}]
  updated_at timestamptz default now()
);

-- RLS: semua tabel, user hanya akses miliknya
alter table profiles enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table global_memory enable row level security;
create policy "own ..." on <tabel> for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## 5. API WORKER

### `POST /api/chat` — SSE streaming (jantung aplikasi)

Request body:
```json
{
  "provider": { "baseUrl": "...", "apiKey": "...", "model": "..." },
  "system": "...",
  "messages": [ { "role": "user", "content": [...] } ],
  "tools": [...]
}
```

Response SSE — protokol event ke browser:
```
data: {"type":"status","phase":"thinking|writing|generating_file"}
data: {"type":"thinking","text":"...delta..."}
data: {"type":"text","text":"...delta..."}
data: {"type":"file","id":"...","filename":"x.py","mime":"...","content":"<base64>"}
data: {"type":"done","content":[...block akhir...],"attachments":[...],"usage":{...}}
data: {"type":"error","message":"..."}
```

### `POST /api/archive/inspect` (fitur 10)
Multipart `file` (`.rar`) → `{ filename, files: [{name, size, isText, content?}] }`
Ekstraksi file teks ≤64KB/file, maks 200 file, arsip ≤25MB. File biner hanya didaftar.

### `POST /api/memory/refresh` (fitur 14)
Body: `{ provider, currentMemory, chats: [...] }` → `{ summary, facts }` (non-streaming).

### `GET /api/health` → `{ ok: true }`

### Static assets
`wrangler.jsonc`: `assets.directory = "../web/dist"`, `not_found_handling: "single-page-application"` → semua rute non-API serve frontend. Dev: Vite proxy `/api` → `localhost:8787`.

---

## 6. MODUL KRITIS

### `worker/src/anthropic.ts` — klien Anthropic + tool loop

1. **Request**: `fetch(baseUrl + "/v1/messages")`, header `x-api-key` + `authorization: Bearer` + `anthropic-version: 2023-06-01`. Body: `{model, max_tokens: 16000, stream: true, system, messages, tools}`.

2. **Tangga fallback thinking** (penting untuk kompatibilitas router pihak ketiga vs Anthropic resmi):
   - Model mengandung "thinking" → coba `thinking: {type:"adaptive", display:"summarized"}` (`display:"summarized"` WAJIB agar thinking terbaca — default "omitted" mengirim block kosong)
   - Kalau 400 → coba `{type:"enabled", budget_tokens: 10000}`
   - Kalau 400 lagi → tanpa `thinking`
   - Kalau 400 lagi → tanpa `tools`
   - Error body upstream diteruskan verbatim ke event `error`

3. **Parser SSE** (~60 baris): `res.body.getReader()` + TextDecoder, buffer dipecah per `"\n\n"`, tiap blok: gabung baris `data:` → `JSON.parse` → dispatch `data.type`: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta` (stop_reason + usage), `message_stop`, `error`.

4. **Tool-use loop** (max 8 iterasi):
   ```
   loop:
     stream upstream, akumulasi block, teruskan event ke client
     if stop_reason != "tool_use": break
     jalankan semua tool_use → tool_result (SATU pesan user)
     conversation += assistant(blocks) + user(tool_results)
   emit done(finalBlocks, attachments, usage)
   ```
   - Input tool dirakit dari `input_json_delta.partial_json` → `JSON.parse` saat `content_block_stop` (JANGAN string-match)
   - Thinking block di-echo verbatim di pesan assistant saat continuasi tool (syarat model thinking)
   - Tool gagal → `is_error: true`, tidak di-drop

### `worker/src/tools.ts` — `create_file`
```
input: { filename, mime_type?, content_text? | content_base64? }
```
- Sanitize filename (basename, karakter aman)
- `content_text` diutamakan untuk file teks (base64 UTF-8 rawan error LLM; Worker yang encode)
- Batas 2MB; emit event `file` live ke browser + lampiran dikembalikan di `done`
- MIME ditebak dari ekstensi kalau tidak diberikan

### `worker/src/rar.ts`
- `node-unrar-js` via dynamic import (WASM tidak menyentuh jalur chat)
- Daftar isi + ekstrak file teks (deteksi: ekstensi dikenal / heuristik tanpa byte 0x00)
- Gagal ekstrak → tetap kembalikan listing (best effort)

### `worker/src/memory.ts`
- System prompt: "merge existing memory with new transcripts → JSON {summary ≤600 kata, facts[]}"
- Budget 400K karakter, chat terbaru diprioritaskan
- Respons di-parse JSON (dengan fallback regex `{...}`)

### `web/src/api/supabase.ts` — klien REST ringan
GoTrue: `/auth/v1/signup`, `/auth/v1/token?grant_type=password`, `/auth/v1/logout`, `/auth/v1/user`.
PostgREST: select/insert/update/delete dengan header `apikey` + `Authorization: Bearer <jwt>`.

### `web/src/api/chat.ts` — konsumen SSE
fetch POST → read stream → parse blok `data:` → panggil handler per tipe event.

### `web/src/useChatApp.ts` — otak frontend
State: `{ user, profile, chats, activeChatId, messagesByChat, streaming }`.
Aksi: `sendMessage`, `editMessage`, `deleteMessage` (+opsi hapus setelahnya), `regenerate`, `newChat`, `deleteChat`, `saveProfile`, `refreshMemory`, `toggleMemory`.

**Alur kirim pesan:**
1. Buat chat row (lazy) bila belum ada; judul = 50 char pertama pesan
2. Susun content blocks: text + image blocks (base64) + block text isi RAR
3. INSERT user message → UPDATE chat.updated_at
4. POST `/api/chat` dengan history penuh + system prompt (persona + extra + memory block jika aktif)
5. Stream → update `streaming` state (UI live: thinking panel, text, file cards)
6. Event `done` → INSERT assistant message (content + attachments) → auto refresh memory tiap 10 pesan assistant

**System prompt assembly:**
```
[profile.system_prompt (persona)]
[profile.extra_instructions]
[MEMORY jika enabled:
 "What you remember about the user across all conversations:
  <summary>
  Facts: <facts list>"]
```

---

## 7. UI / KOMPONEN

- **AuthGate**: form login/signup (email + password), error inline
- **Sidebar**: tombol "Chat baru" (fitur 4), daftar chat (judul + waktu, klik pindah, tombol hapus), toggle "Memory" (fitur 14), tombol Settings, info user + logout
- **MessageList**: render semua pesan + pesan streaming di akhir, auto-scroll ke bawah
- **Message** (per pesan):
  - ThinkingBlock: `<details>` collapsible, "Thinking…" berdenyut saat streaming (fitur 1)
  - MarkdownBody: marked + DOMPurify (sanitasi HTML AI)
  - ImageAttachment: thumbnail, klik → overlay zoom (fitur 8, 9)
  - FileCard: ikon + nama + ukuran + tombol Download (Blob → objectURL → `a[download]`) (fitur 5)
  - ArchiveCard: nama RAR + daftar isi + preview teks (fitur 10)
  - Aksi per pesan: copy / edit (user) / regenerate (assistant) / delete (fitur 2, 3)
- **EditComposer**: textarea inline, "Simpan & kirim ulang" → update DB → hapus pesan setelahnya → resend
- **Composer**: textarea (Enter=kirim, Shift+Enter=baris), tombol attach gambar (image/*, ≤5MB), tombol attach RAR (.rar), indikator status live ("Thinking…", "Generating file…", "Menulis…")
- **SettingsModal** (fitur 6, 7, 11):
  - Personalisasi: textarea persona/system prompt
  - Instruksi tambahan: textarea "diterapkan apa adanya" (untuk "gak boleh nolak" user tulis sendiri — app hanya pipa teks user)
  - Provider: nama provider, base URL, model, API key (prefill default dari ai.txt; catatan "tersimpan di Supabase Anda, hanya visible ke Anda")
  - Memory: toggle + tombol "Refresh memory sekarang" + waktu update terakhir
- **styles.css**: dark theme, CSS variables, tanpa font eksternal, layout flexbox/grid responsif

---

## 8. PHASE-PHASE IMPLEMENTASI

> Tiap phase menghasilkan app yang bisa dijalankan & dites. Jangan lanjut phase berikut sebelum phase saat ini lolos verifikasi.

### PHASE 0 — Setup & dokumentasi (½ jam)
- [ ] Salin rencana ini ke `PLAN.md` di root proyek
- [ ] `package.json` root (workspaces), `.gitignore`, `git init` + repo GitHub (fitur 13)
- [ ] `web/package.json`, `worker/package.json`, kedua `tsconfig.json`
- [ ] `web/.env.example`
- **Verifikasi**: `npm install` sukses di root

### PHASE 1 — Skema & skeleton jalan (1-2 jam)
- [ ] `supabase/schema.sql` (4 tabel + RLS)
- [ ] `worker/wrangler.jsonc`, `worker/src/index.ts` (`/api/health` + fallback assets)
- [ ] `worker/src/anthropic.ts`: parser SSE + streaming teks (TANPA thinking/tools dulu)
- [ ] `web/`: Vite + React + `AuthGate` + `ChatView` + `Composer` + `MessageList` (render teks polos)
- [ ] `web/src/api/supabase.ts` (auth) + `web/src/api/chat.ts` (SSE)
- [ ] `styles.css` dasar
- **Verifikasi**: login → kirim pesan → jawaban AI muncul streaming. Endpoint default ai.txt terpakai.

### PHASE 2 — Persistensi & manajemen chat (1 jam)
- [ ] CRUD chats/messages via PostgREST (insert/update/delete)
- [ ] `Sidebar`: daftar chat, chat baru (lazy), pindah chat, hapus chat, judul otomatis
- [ ] `useChatApp.ts`: load history saat buka chat, `messagesByChat`
- **Verifikasi**: chat bertahan setelah reload; buka 2 chat bergantian, history benar masing-masing

### PHASE 3 — Aksi pesan: edit & delete (1 jam)
- [ ] `EditComposer` + alur edit: PATCH → hapus pesan setelahnya → resend
- [ ] Delete: hapus pesan itu saja / hapus dari situ ke bawah (menjaga role berpasangan untuk API)
- [ ] Regenerate jawaban assistant
- [ ] Tombol copy
- **Verifikasi**: edit pesan → jawaban berubah sesuai konteks baru; delete → history konsisten

### PHASE 4 — Thinking & status indicator (1 jam)
- [ ] Deteksi model thinking + tangga fallback di `anthropic.ts`
- [ ] Event `thinking` + `status` → `ThinkingBlock` live collapsible + indikator "Thinking…" di Composer
- [ ] Thinking block disimpan & dirender ulang dari history
- **Verifikasi**: chat dengan model `-thinking` → panel thinking muncul live, bisa dibuka/tutup

### PHASE 5 — Settings: personalisasi + provider (1 jam)
- [ ] `SettingsModal`: persona, extra instructions, provider (nama/base URL/model/api key)
- [ ] Tabel `profiles` + RLS terhubung; profil dibuat otomatis saat signup/login pertama
- [ ] System prompt assembly (persona + extra)
- **Verifikasi**: ganti persona → jawaban AI berubah gaya; ganti base URL/model → pakai provider baru

### PHASE 6 — Generate file (1-2 jam)
- [ ] `worker/src/tools.ts`: tool `create_file` + eksekutor
- [ ] Tool-use loop di `anthropic.ts` (input_json_delta, satu pesan tool_result, echo thinking)
- [ ] `FileCard` (Blob download) + persist `attachments`
- [ ] Status "Generating file…" saat tool berjalan
- **Verifikasi**: minta AI buat file `.py`/`.csv`/`.html` → kartu file muncul → download → isi benar

### PHASE 7 — Vision: upload gambar (1 jam)
- [ ] Composer: tombol attach gambar, preview sebelum kirim
- [ ] Block `{type:"image", source:{type:"base64", media_type, data}}` di pesan user
- [ ] `ImageAttachment`: render di riwayat + klik zoom
- **Verifikasi**: kirim gambar → AI menjawab tentang isi gambar (jika model support vision)

### PHASE 8 — Memory global (1-2 jam)
- [ ] `worker/src/memory.ts` + `/api/memory/refresh`
- [ ] Toggle memory di sidebar → `profiles.memory_enabled`
- [ ] Injeksi blok memori ke system prompt saat ON; OFF = per-chat saja
- [ ] UI Settings: refresh manual + last-updated; auto-refresh tiap 10 pesan assistant
- **Verifikasi**: ON → chat di 2 chat berbeda tentang info pribadi → refresh → AI "ingat" di chat baru. OFF → tidak ingat.

### PHASE 9 — RAR (1-2 jam, risiko tertinggi, bisa di-skip tanpa merusak lain)
- [ ] `worker/src/rar.ts` + `/api/archive/inspect`
- [ ] Composer: tombol attach RAR → inspect → embed listing + teks ke pesan
- [ ] `ArchiveCard`
- **Verifikasi**: kirim `.rar` berisi file teks → AI bisa menjawab isi filenya
- **Fallback kalau WASM gagal di Workers**: tampilkan error jelas; opsi ekstraksi di browser (escape hatch, jangan dikerjakan dulu)

### PHASE 10 — Deploy (½ jam)
- [ ] `npm run build` frontend → `wrangler deploy`
- [ ] Supabase: tambahkan domain Worker ke URL config
- [ ] (Opsional) GitHub Actions: build + deploy on push
- **Verifikasi**: buka URL Workers → login → chat normal di produksi

---

## 9. RISIKO & MITIGASI

| Risiko | Mitigasi |
|---|---|
| WASM unrar >1MB (batas free plan Workers) | Dynamic import; feature best-effort; escape hatch ekstraksi browser |
| Router pihak ketiga beda surface API (thinking/tools) | Tangga fallback 400 + error upstream diteruskan verbatim |
| Buffering SSE di Worker | Return `ReadableStream` langsung; header `no-cache`, `x-accel-buffering: no` |
| Memori tumbuh tak terbatas | Summary ≤600 kata; budget 400K char; refresh bertahap (terbaru dulu) |
| API key user di DB | RLS strict; tradeoff dijelaskan di UI Settings; single-user app |
| Attachment besar | Cap 2MB di tool; >1MB praktisnya jsonb — nanti Supabase Storage |

---

## 10. VERIFIKASI END-TO-END (setelah semua phase)

1. `npm install` di root → `npm run build --workspace web`
2. Supabase: buat project → run `schema.sql` → matikan konfirmasi email → isi `web/.env`
3. Dev lokal: 2 terminal — `npm run dev --workspace worker` (:8787) + `npm run dev --workspace web` (:5173)
4. Skenario tes lengkap:
   - Daftar akun → login
   - Chat biasa → streaming + thinking panel muncul
   - Minta AI buat file `.py` → download, isi benar
   - Upload gambar → AI menjawab isinya
   - Upload `.rar` → AI menjawab isi file teks di dalamnya
   - Edit pesan → regenerate; delete pesan → history konsisten
   - Settings: ganti persona → efek terlihat; isi extra instructions → diterapkan
   - Memory ON → 2 chat → refresh → AI ingat antar chat; OFF → tidak
5. Deploy: `wrangler login` → `npm run deploy` → tes ulang skenario di URL produksi
