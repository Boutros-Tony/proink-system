-- ProInk Studio. Separate from the website tables (projects, clients, quotation_*, media).
-- Nothing in this file alters those tables. Studio rows are named studio_*.

create schema if not exists studio_private;

create table public.studio_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'estimator' check (role in ('admin', 'estimator', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function studio_private.role()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select role from public.studio_profiles where id = auth.uid()
$$;

create or replace function studio_private.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select studio_private.role() in ('admin', 'estimator')
$$;

revoke all on schema studio_private from public, anon;
grant usage on schema studio_private to authenticated;
revoke all on function studio_private.role() from public, anon;
revoke all on function studio_private.can_write() from public, anon;
grant execute on function studio_private.role() to authenticated;
grant execute on function studio_private.can_write() to authenticated;

-- True only before the first studio account exists. The login page uses this to show sign-up once.
create or replace function public.studio_needs_bootstrap()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select not exists (select 1 from public.studio_profiles)
$$;

revoke all on function public.studio_needs_bootstrap() from public;
grant execute on function public.studio_needs_bootstrap() to anon, authenticated;

create or replace function studio_private.assign_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.studio_profiles) = 0 then
      new.role := 'admin';
    else
      new.role := 'estimator';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role and studio_private.role() is distinct from 'admin' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

create trigger studio_profiles_assign_role
  before insert or update on public.studio_profiles
  for each row execute function studio_private.assign_profile_role();

create or replace function studio_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  insert into public.studio_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;


create trigger studio_on_auth_user_created
  after insert on auth.users
  for each row execute function studio_private.handle_new_user();

create table public.studio_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.studio_client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.studio_clients (id) on delete cascade,
  name text not null default '',
  role text not null default '',
  phone text not null default '',
  email text not null default ''
);

create table public.studio_client_locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.studio_clients (id) on delete cascade,
  place text not null default '',
  spot text not null default '',
  width_mm integer not null default 0,
  height_mm integer not null default 0,
  depth_mm integer not null default 0
);

create table public.studio_materials (
  id text primary key,
  name text not null,
  piece text check (piece in ('paint', 'mdf', 'wood', 'laminate', 'metal', 'glass')),
  unit text not null check (unit in ('board', 'm2')),
  price_cents integer not null check (price_cents >= 0),
  board_width_mm numeric,
  board_height_mm numeric,
  thickness_mm numeric,
  waste_percent numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table public.studio_price_items (
  id text primary key,
  name text not null,
  "group" text not null,
  unit text not null,
  price_cents integer not null check (price_cents >= 0),
  updated_at timestamptz not null default now()
);

create table public.studio_catalog_prices (
  sku text primary key,
  price_cents integer not null check (price_cents >= 0)
);

create table public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  client_id uuid references public.studio_clients (id) on delete set null,
  client_name text not null default '',
  source_kind text not null default 'description' check (source_kind in ('simulation', 'technical', '3d_file', 'description')),
  margin_percent numeric not null default 20,
  document jsonb not null default '{}'::jsonb,
  costing jsonb not null default '{"version":1,"overrides":{},"extras":[],"review":null}'::jsonb,
  simulation_path text,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_chats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.studio_projects (id) on delete cascade,
  mode text not null default 'quote' check (mode in ('quote', 'design', 'image')),
  title text not null default 'New chat',
  provider text not null default '',
  model text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects (id) on delete cascade,
  bucket text not null,
  path text not null,
  filename text not null default '',
  mime text not null default '',
  bytes integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.studio_design_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects (id) on delete cascade,
  document jsonb not null,
  design_key text not null default '',
  author text not null default 'user' check (author in ('user', 'ai')),
  created_at timestamptz not null default now()
);

create index studio_design_versions_project_idx on public.studio_design_versions (project_id, created_at desc);
create index studio_projects_updated_idx on public.studio_projects (updated_at desc);

create table public.studio_quotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.studio_projects (id) on delete set null,
  ref text,
  revision integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'sent', 'won', 'lost', 'cancelled')),
  origin text not null default 'studio' check (origin in ('studio', 'imported')),
  source_kind text not null default 'description',
  title text not null default '',
  currency text not null default 'USD',
  vat_percent numeric not null default 11,
  cost_cents integer not null default 0,
  sell_cents integer not null default 0,
  vat_cents integer not null default 0,
  grand_total_cents integer not null default 0,
  validity_days integer,
  payment_terms text not null default '',
  production_days integer,
  notes text not null default '',
  pdf_path text,
  is_reference boolean not null default false,
  issued_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.studio_quotation_sections (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.studio_quotations (id) on delete cascade,
  seq integer not null,
  code text not null default '',
  kind text not null default 'other',
  title text not null default '',
  measure_qty numeric,
  measure_unit text,
  specs jsonb not null default '[]'::jsonb,
  includes jsonb not null default '[]'::jsonb,
  excludes jsonb not null default '[]'::jsonb,
  sell_cents integer not null default 0,
  cost_cents integer not null default 0
);

create table public.studio_quotation_elements (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.studio_quotations (id) on delete cascade,
  section_id uuid references public.studio_quotation_sections (id) on delete set null,
  name text not null,
  kind text not null default 'built',
  shape text,
  width_mm numeric,
  height_mm numeric,
  depth_mm numeric,
  quantity numeric not null default 1,
  material text,
  real_material text,
  finish text,
  letters_text text,
  estimated boolean not null default false
);

create table public.studio_quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.studio_quotations (id) on delete cascade,
  section_id uuid references public.studio_quotation_sections (id) on delete set null,
  "group" text not null default 'other',
  description text not null,
  quantity numeric not null,
  unit text not null,
  unit_cost_cents integer not null default 0,
  total_cost_cents integer not null default 0,
  source text not null default 'imported',
  ref text,
  reason text
);

create table public.studio_section_rates (
  id uuid primary key default gen_random_uuid(),
  section_kind text not null,
  basis text not null,
  sell_cents_per_unit integer not null,
  cost_cents_per_unit integer,
  sample_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.studio_corrections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.studio_projects (id) on delete set null,
  quotation_id uuid references public.studio_quotations (id) on delete set null,
  target text not null,
  ai_value jsonb not null,
  final_value jsonb not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table public.studio_ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id),
  project_id uuid references public.studio_projects (id) on delete set null,
  mode text not null default '',
  provider text not null default '',
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_mills integer not null default 0,
  created_at timestamptz not null default now()
);

