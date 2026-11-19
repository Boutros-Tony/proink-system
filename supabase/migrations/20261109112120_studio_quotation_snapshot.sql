-- A frozen quotation keeps the client, the design, and the prices it was issued with.
alter table public.studio_quotations add column client_name text not null default '';
alter table public.studio_quotations add column attention text not null default '';
alter table public.studio_quotations add column margin_percent numeric not null default 20;
alter table public.studio_quotations add column design jsonb not null default '{}'::jsonb;
alter table public.studio_quotations add column price_book jsonb not null default '{}'::jsonb;

create unique index studio_quotations_ref_revision_idx on public.studio_quotations (ref, revision);
