begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select ok(
  to_regprocedure('public.set_updated_at()') is not null,
  'set_updated_at exists'
);

select is(
  (
    select procedure.prorettype::regtype::text
    from pg_proc as procedure
    where procedure.oid = to_regprocedure('public.set_updated_at()')
  ),
  'trigger',
  'set_updated_at returns trigger'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = to_regprocedure('public.set_updated_at()')
  ),
  'set_updated_at uses security invoker'
);

select ok(
  to_regprocedure('public.health_check()') is not null,
  'health_check exists'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = to_regprocedure('public.health_check()')
  ),
  'health_check uses security invoker'
);

select is(
  (select result.status from public.health_check() as result),
  'ok',
  'health_check returns ok'
);

select is(
  (
    select pg_typeof(result.status)::text
    from public.health_check() as result
  ),
  'text',
  'health_check status is text'
);

select is(
  (
    select pg_typeof(result.checked_at)::text
    from public.health_check() as result
  ),
  'timestamp with time zone',
  'health_check checked_at is timestamptz'
);

select ok(
  (select result.checked_at is not null from public.health_check() as result),
  'health_check checked_at is not null'
);

select ok(
  (
    select result.checked_at
      between current_timestamp - interval '1 minute'
      and current_timestamp + interval '1 minute'
    from public.health_check() as result
  ),
  'health_check checked_at is a reasonable database time'
);

select ok(
  has_function_privilege('anon', 'public.health_check()', 'execute'),
  'anon can execute health_check'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.health_check()',
    'execute'
  ),
  'authenticated can execute health_check'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) as privilege
    where procedure.oid = to_regprocedure('public.health_check()')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public has no execute grant on health_check'
);

select ok(
  not has_function_privilege('anon', 'public.set_updated_at()', 'execute'),
  'anon cannot execute set_updated_at'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_updated_at()',
    'execute'
  ),
  'authenticated cannot execute set_updated_at'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
  ),
  0,
  'foundation migration creates no business tables'
);

select * from finish();

rollback;
