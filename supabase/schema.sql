-- Skema database AI Chat — jalankan di Supabase SQL Editor
create extension if not exists pgcrypto;

-- Profil pengguna: personalisasi AI + konfigurasi provider
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

-- Daftar chat
create table chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Chat baru',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on chats (user_id, updated_at desc);

-- Pesan: content = block Anthropic (text/thinking/image/tool_use)
-- attachments = file hasil generate AI + metadata arsip RAR
create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  attachments jsonb default '[]',
  created_at timestamptz default now()
);
create index on messages (chat_id, created_at);

-- Memori global: gabungan ringkasan semua chat
create table global_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text default '',
  facts jsonb default '[]',
  updated_at timestamptz default now()
);

-- Row Level Security: user hanya bisa akses datanya sendiri
alter table profiles enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table global_memory enable row level security;

create policy "own profiles" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own chats" on chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own messages" on messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own memory" on global_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
