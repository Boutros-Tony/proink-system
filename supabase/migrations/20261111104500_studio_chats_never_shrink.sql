-- A chat never loses messages through an update. A save that carries fewer messages than are stored
-- (a browser that lost its state, an old tab) keeps the stored messages. The rest of the update still applies.
create or replace function public.studio_chats_keep_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(old.messages) = 'array'
     and (new.messages is null
          or jsonb_typeof(new.messages) <> 'array'
          or jsonb_array_length(new.messages) < jsonb_array_length(old.messages)) then
    new.messages := old.messages;
  end if;
  return new;
end;
$$;

drop trigger if exists studio_chats_keep_messages on public.studio_chats;
create trigger studio_chats_keep_messages
  before update of messages on public.studio_chats
  for each row execute function public.studio_chats_keep_messages();
