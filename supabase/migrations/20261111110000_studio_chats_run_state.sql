-- A reply keeps running on the server after a reload or a closed tab.
-- run_started_at is set while a reply is being written, so a reopened chat can show it is still working.
-- run_stop is the Stop button: the server checks it while it works and ends the reply.
alter table public.studio_chats
  add column if not exists run_started_at timestamptz,
  add column if not exists run_stop boolean not null default false;
