create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  uname text;
  dname text;
begin
  base := lower(coalesce(nullif(m->>'username', ''), nullif(m->>'user_name', ''), nullif(m->>'preferred_username', ''), split_part(coalesce(new.email, ''), '@', 1), 'jugador'));
  base := left(regexp_replace(base, '[^a-z0-9_]', '', 'g'), 15);
  if length(base) < 3 then base := 'jugador'; end if;
  uname := base;
  while exists (select 1 from public.profiles where username = uname) loop
    uname := base || (floor(random() * 9000) + 1000)::int;
  end loop;
  dname := coalesce(nullif(m->>'display_name', ''), nullif(m->>'full_name', ''), nullif(m->>'name', ''), uname);
  insert into public.profiles (id, username, display_name) values (new.id, uname, dname);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.username_available(u text) returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references public.profiles on delete cascade,
  player1_id uuid references public.profiles on delete set null,
  player1_name text not null,
  player2_id uuid references public.profiles on delete set null,
  player2_name text not null,
  mode text not null default 'tennis' check (mode in ('tennis', 'points')),
  target int not null default 11,
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
create policy "matches_select" on public.matches for select to authenticated using (auth.uid() in (host_id, player1_id, player2_id));

drop policy if exists "matches_insert" on public.matches;
create policy "matches_insert" on public.matches for insert to authenticated with check (auth.uid() = host_id);

drop policy if exists "matches_update" on public.matches;
create policy "matches_update" on public.matches for update to authenticated using (auth.uid() in (host_id, player1_id, player2_id));

drop policy if exists "matches_delete" on public.matches;
create policy "matches_delete" on public.matches for delete to authenticated using (auth.uid() = host_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches for each row execute function public.touch_updated_at();

alter table public.matches replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null;
end $$;
