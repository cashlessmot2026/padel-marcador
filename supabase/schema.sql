-- iTag Score · esquema de base de datos
-- Pega todo este archivo en Supabase → SQL Editor → Run.

-- ───────────── PERFILES ─────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- Crea el perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), new.raw_user_meta_data->>'username')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Comprobar si un usuario está libre antes de registrarse
create or replace function public.username_available(u text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ───────────── PARTIDOS / INVITACIONES ─────────────
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references public.profiles on delete cascade,
  player1_id uuid references public.profiles on delete set null,
  player1_name text not null,
  player2_id uuid references public.profiles on delete set null,   -- null = jugador local sin cuenta
  player2_name text not null,
  mode text not null default 'tennis' check (mode in ('tennis', 'points')),
  target int not null default 11,          -- puntos por set en modo "points"
  status text not null default 'invited' check (status in ('invited', 'active', 'declined', 'finished')),
  state jsonb,
  winner_slot int check (winner_slot in (0, 1)),
  winner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists matches_player2_idx on public.matches (player2_id, status);
create index if not exists matches_host_idx on public.matches (host_id, status);

alter table public.matches enable row level security;

drop policy if exists "matches_select" on public.matches;
create policy "matches_select" on public.matches
  for select to authenticated
  using (auth.uid() in (host_id, player1_id, player2_id));

drop policy if exists "matches_insert" on public.matches;
create policy "matches_insert" on public.matches
  for insert to authenticated with check (auth.uid() = host_id);

drop policy if exists "matches_update" on public.matches;
create policy "matches_update" on public.matches
  for update to authenticated
  using (auth.uid() in (host_id, player1_id, player2_id));

drop policy if exists "matches_delete" on public.matches;
create policy "matches_delete" on public.matches
  for delete to authenticated using (auth.uid() = host_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

-- Tiempo real (invitaciones y marcador en vivo)
alter table public.matches replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null;
end $$;
