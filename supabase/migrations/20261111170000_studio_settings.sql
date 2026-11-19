-- Shop-wide settings kept as one JSON value per key, such as the finishing rules ("shop_rules").

create table public.studio_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.studio_settings enable row level security;
revoke all on public.studio_settings from anon, public;
grant select, insert, update, delete on public.studio_settings to authenticated;

create policy studio_settings_select on public.studio_settings
  for select to authenticated using (studio_private.role() is not null);
create policy studio_settings_insert on public.studio_settings
  for insert to authenticated with check (studio_private.can_write());
create policy studio_settings_update on public.studio_settings
  for update to authenticated using (studio_private.can_write()) with check (studio_private.can_write());
create policy studio_settings_delete on public.studio_settings
  for delete to authenticated using (studio_private.can_write());
