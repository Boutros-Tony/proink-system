-- Row security, storage buckets, and who may read or change studio rows.

alter table public.studio_profiles enable row level security;
revoke all on public.studio_profiles from anon, public;
grant select, insert, update, delete on public.studio_profiles to authenticated;

create policy studio_profiles_select on public.studio_profiles
  for select to authenticated
  using (id = auth.uid() or studio_private.role() = 'admin');

create policy studio_profiles_insert on public.studio_profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy studio_profiles_update on public.studio_profiles
  for update to authenticated
  using (id = auth.uid() or studio_private.role() = 'admin')
  with check (id = auth.uid() or studio_private.role() = 'admin');

do $$
declare
  shop_table text;
begin
  foreach shop_table in array array[
    'studio_clients',
    'studio_client_contacts',
    'studio_client_locations',
    'studio_materials',
    'studio_price_items',
    'studio_catalog_prices',
    'studio_projects',
    'studio_chats',
    'studio_attachments',
    'studio_design_versions',
    'studio_quotations',
    'studio_quotation_sections',
    'studio_quotation_elements',
    'studio_quotation_lines',
    'studio_section_rates',
    'studio_corrections',
    'studio_ai_runs'
  ]
  loop
    execute format('alter table public.%I enable row level security', shop_table);
    execute format('revoke all on public.%I from anon, public', shop_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', shop_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (studio_private.role() is not null)',
      shop_table || '_select', shop_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (studio_private.can_write())',
      shop_table || '_insert', shop_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (studio_private.can_write()) with check (studio_private.can_write())',
      shop_table || '_update', shop_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (studio_private.can_write())',
      shop_table || '_delete', shop_table
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('studio-attachments', 'studio-attachments', false, 20971520),
  ('studio-simulations', 'studio-simulations', false, 20971520),
  ('studio-quotations', 'studio-quotations', false, 20971520),
  ('studio-projects', 'studio-projects', false, 52428800),
  ('studio-assets', 'studio-assets', false, 52428800)
on conflict (id) do nothing;

create policy studio_storage_select on storage.objects
  for select to authenticated
  using (bucket_id like 'studio-%' and studio_private.role() is not null);

create policy studio_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id like 'studio-%' and studio_private.can_write());

create policy studio_storage_update on storage.objects
  for update to authenticated
  using (bucket_id like 'studio-%' and studio_private.can_write())
  with check (bucket_id like 'studio-%' and studio_private.can_write());

create policy studio_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id like 'studio-%' and studio_private.can_write());
