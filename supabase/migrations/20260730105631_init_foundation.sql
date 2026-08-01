create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  new.updated_at = current_timestamp;
  return new;
end;
$function$;

comment on function public.set_updated_at() is
  'Sets NEW.updated_at for a row update. A table migration must explicitly create a trigger that calls this function.';

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create or replace function public.health_check()
returns table (
  status text,
  checked_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select 'ok'::text, current_timestamp;
$function$;

comment on function public.health_check() is
  'Returns a minimal non-sensitive database availability result.';

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon;
grant execute on function public.health_check() to authenticated;
