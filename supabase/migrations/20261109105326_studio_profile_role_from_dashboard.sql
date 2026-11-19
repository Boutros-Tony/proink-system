-- The dashboard SQL editor has no studio session. Keep the role typed there.
-- A signed-in person still cannot grant themselves a higher role.
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
    elsif auth.uid() is not null then
      new.role := 'estimator';
    elsif new.role is null then
      new.role := 'estimator';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     and auth.uid() is not null
     and studio_private.role() is distinct from 'admin' then
    new.role := old.role;
  end if;
  return new;
end;
$$;
