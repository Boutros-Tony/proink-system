-- Studio accounts are created in the dashboard. The app no longer signs people up or inserts its own profile.
drop policy if exists studio_profiles_insert on public.studio_profiles;

revoke all on function public.studio_needs_bootstrap() from public, anon, authenticated;
drop function if exists public.studio_needs_bootstrap();

-- A user added in the dashboard gets a studio profile. Public signup is turned off separately.
create trigger studio_on_auth_user_created
  after insert on auth.users
  for each row execute function studio_private.handle_new_user();

alter table public.studio_ai_runs add column note_id text;
alter table public.studio_ai_runs add column counted boolean not null default true;
alter table public.studio_ai_runs add constraint studio_ai_runs_note_id_key unique (note_id);

create table public.studio_library (
  id text primary key,
  kind text not null check (kind in ('image', 'mesh')),
  name text not null default '',
  path text not null,
  mime text not null default '',
  width numeric not null default 0,
  height numeric not null default 0,
  depth numeric not null default 0,
  bytes integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.studio_library enable row level security;
grant select, insert, update, delete on public.studio_library to authenticated;

create policy studio_library_select on public.studio_library for select to authenticated
  using (studio_private.role() is not null);
create policy studio_library_insert on public.studio_library for insert to authenticated
  with check (studio_private.can_write());
create policy studio_library_update on public.studio_library for update to authenticated
  using (studio_private.can_write()) with check (studio_private.can_write());
create policy studio_library_delete on public.studio_library for delete to authenticated
  using (studio_private.can_write());
