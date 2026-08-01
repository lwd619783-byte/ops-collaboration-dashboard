begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

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

-- The foundation migration itself introduces no business tables (only the
-- set_updated_at and health_check helpers). Business tables are introduced by
-- later, isolated feature migrations. This assertion tracks the cumulative
-- business-table count of the current schema and MUST be bumped whenever a new
-- business table is added by a subsequent task. At Task 1.2 the schema defines
-- exactly four business tables: app_users, profiles, user_identities,
-- identity_binding_challenges.
select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
  ),
  4,
  'current schema defines exactly four business tables (foundation adds none)'
);

create function public.default_privilege_probe()
returns text
language sql
security invoker
set search_path = pg_catalog
as $function$
  select 'probe-ok'::text;
$function$;

select ok(
  to_regprocedure('public.default_privilege_probe()') is not null,
  'default privilege probe exists inside the test transaction'
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
    where procedure.oid =
      to_regprocedure('public.default_privilege_probe()')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute a newly created public function'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.default_privilege_probe()',
    'execute'
  ),
  'anon cannot execute a newly created public function'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.default_privilege_probe()',
    'execute'
  ),
  'authenticated cannot execute a newly created public function'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.default_privilege_probe()',
    'execute'
  ),
  'service_role cannot execute a newly created public function'
);

set local role anon;

select throws_ok(
  'select public.default_privilege_probe()',
  '42501',
  'permission denied for function default_privilege_probe',
  'anon execution is denied before an explicit grant'
);

reset role;

grant execute on function public.default_privilege_probe() to anon;

select ok(
  has_function_privilege(
    'anon',
    'public.default_privilege_probe()',
    'execute'
  ),
  'an explicit grant allows anon to execute the probe'
);

set local role anon;

select is(
  public.default_privilege_probe(),
  'probe-ok',
  'anon can actually execute the probe after an explicit grant'
);

reset role;

select * from finish();

rollback;
