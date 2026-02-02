-- Run this in Supabase SQL editor

-- PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  whatsapp text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles_upsert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- SESSIONS
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  helper_id uuid references auth.users(id) on delete set null,
  requester_name text,
  requester_note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

alter table public.sessions enable row level security;

-- helper can see own sessions
create policy "sessions_select_helper"
on public.sessions for select
to authenticated
using (helper_id = auth.uid());

create policy "sessions_insert_helper"
on public.sessions for insert
to authenticated
with check (helper_id = auth.uid());

create policy "sessions_update_helper"
on public.sessions for update
to authenticated
using (helper_id = auth.uid())
with check (helper_id = auth.uid());

-- SNAPSHOTS metadata
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  helper_id uuid references auth.users(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.snapshots enable row level security;

create policy "snapshots_select_helper"
on public.snapshots for select
to authenticated
using (helper_id = auth.uid());

create policy "snapshots_insert_helper"
on public.snapshots for insert
to authenticated
with check (helper_id = auth.uid());
