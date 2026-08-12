begin;

create extension if not exists pgtap with schema extensions;

-- Execute statements as the current role and return their real SQLSTATE.
create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception
  when others then
    return sqlstate::text;
end;
$function$;

create function pg_temp.rows_affected(p_sql text)
returns integer
language plpgsql
as $function$
declare
  v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
exception
  when others then
    return -1;
end;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.rows_affected(text) to public;

select plan(61);

-- Exact effective table ACL. MAINTAIN is included because PostgreSQL 17 adds
-- it to ALL/default table ACLs and it is not an application browser privilege.
with acl_cases(role_name, table_name, privilege_name, expected) as (
  values
    ('anon', 'app_users', 'SELECT', false),
    ('anon', 'app_users', 'INSERT', false),
    ('anon', 'app_users', 'UPDATE', false),
    ('anon', 'app_users', 'DELETE', false),
    ('anon', 'app_users', 'TRUNCATE', false),
    ('anon', 'app_users', 'REFERENCES', false),
    ('anon', 'app_users', 'TRIGGER', false),
    ('anon', 'app_users', 'MAINTAIN', false),
    ('anon', 'profiles', 'SELECT', false),
    ('anon', 'profiles', 'INSERT', false),
    ('anon', 'profiles', 'UPDATE', false),
    ('anon', 'profiles', 'DELETE', false),
    ('anon', 'profiles', 'TRUNCATE', false),
    ('anon', 'profiles', 'REFERENCES', false),
    ('anon', 'profiles', 'TRIGGER', false),
    ('anon', 'profiles', 'MAINTAIN', false),
    ('authenticated', 'app_users', 'SELECT', true),
    ('authenticated', 'app_users', 'INSERT', false),
    ('authenticated', 'app_users', 'UPDATE', false),
    ('authenticated', 'app_users', 'DELETE', false),
    ('authenticated', 'app_users', 'TRUNCATE', false),
    ('authenticated', 'app_users', 'REFERENCES', false),
    ('authenticated', 'app_users', 'TRIGGER', false),
    ('authenticated', 'app_users', 'MAINTAIN', false),
    ('authenticated', 'profiles', 'SELECT', true),
    ('authenticated', 'profiles', 'INSERT', false),
    ('authenticated', 'profiles', 'UPDATE', false),
    ('authenticated', 'profiles', 'DELETE', false),
    ('authenticated', 'profiles', 'TRUNCATE', false),
    ('authenticated', 'profiles', 'REFERENCES', false),
    ('authenticated', 'profiles', 'TRIGGER', false),
    ('authenticated', 'profiles', 'MAINTAIN', false)
)
select is(
  has_table_privilege(
    role_name,
    format('public.%I', table_name),
    privilege_name
  ),
  expected,
  format('%s effective %s on public.%s is %s',
    role_name, privilege_name, table_name, expected)
)
from acl_cases;

-- Distinguish direct table ACL entries from effective privileges (which can
-- also include role inheritance or PUBLIC). authenticated must have exactly
-- SELECT at table level; anon and PUBLIC must have no direct table grants.
select is(
  (
    select coalesce(
      array_agg(x.privilege_type::text order by x.privilege_type::text)
        filter (where x.privilege_type is not null),
      array[]::text[]
    )
    from pg_class as c
    left join lateral aclexplode(c.relacl) as x
      on x.grantee = 'authenticated'::regrole
    where c.oid = format('public.%I', table_name)::regclass
  ),
  array['SELECT']::text[],
  format('authenticated direct table ACL on public.%s is exactly SELECT', table_name)
)
from (values ('app_users'::text), ('profiles'::text)) as tables(table_name);

select is(
  (
    select coalesce(
      array_agg(x.privilege_type::text order by x.privilege_type::text)
        filter (where x.privilege_type is not null),
      array[]::text[]
    )
    from pg_class as c
    left join lateral aclexplode(c.relacl) as x
      on x.grantee = 'anon'::regrole
    where c.oid = format('public.%I', table_name)::regclass
  ),
  array[]::text[],
  format('anon has no direct table ACL on public.%s', table_name)
)
from (values ('app_users'::text), ('profiles'::text)) as tables(table_name);

select is(
  (
    select coalesce(
      array_agg(x.privilege_type::text order by x.privilege_type::text)
        filter (where x.privilege_type is not null),
      array[]::text[]
    )
    from pg_class as c
    left join lateral aclexplode(c.relacl) as x
      on x.grantee = 0
    where c.oid = format('public.%I', table_name)::regclass
  ),
  array[]::text[],
  format('PUBLIC has no direct table ACL on public.%s', table_name)
)
from (values ('app_users'::text), ('profiles'::text)) as tables(table_name);

-- The only authenticated UPDATE privileges on profiles are the six reviewed
-- columns. Table-level UPDATE stays false, and the dynamic deny assertion
-- covers every current or future non-whitelisted column (especially user_id).
select is(
  has_column_privilege(
    'authenticated',
    'public.profiles',
    column_name,
    'UPDATE'
  ),
  true,
  format('authenticated may UPDATE public.profiles.%s', column_name)
)
from (
  values
    ('display_name'::text),
    ('avatar_url'::text),
    ('organization_name'::text),
    ('title'::text),
    ('contact_info'::text),
    ('updated_at'::text)
) as allowed(column_name);

select ok(
  not exists (
    select 1
    from pg_attribute as a
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname <> all(array[
        'display_name',
        'avatar_url',
        'organization_name',
        'title',
        'contact_info',
        'updated_at'
      ]::name[])
      and has_column_privilege(
        'authenticated',
        'public.profiles',
        a.attname,
        'UPDATE'
      )
  ),
  'authenticated cannot UPDATE any non-whitelisted profiles column'
);

select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute as a
    cross join lateral aclexplode(a.attacl) as x
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and x.grantee = 'authenticated'::regrole
      and x.privilege_type = 'UPDATE'
  ),
  array[
    'avatar_url',
    'contact_info',
    'display_name',
    'organization_name',
    'title',
    'updated_at'
  ]::text[],
  'authenticated direct profiles column UPDATE ACL is exactly the six-column whitelist'
);

select ok(
  not exists (
    select 1
    from pg_attribute as a
    where a.attrelid = 'public.app_users'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.app_users',
        a.attname,
        'UPDATE'
      )
  ),
  'authenticated has no app_users column UPDATE privilege'
);

-- RLS is not a TRUNCATE boundary. This invariant keeps browser roles from
-- receiving high-impact table privileges on any project table in public.
select ok(
  not exists (
    select 1
    from pg_class as c
    cross join (values ('anon'::text), ('authenticated'::text)) as roles(role_name)
    cross join (
      values
        ('TRUNCATE'::text),
        ('REFERENCES'::text),
        ('TRIGGER'::text),
        ('MAINTAIN'::text)
    ) as privileges(privilege_name)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and has_table_privilege(role_name, c.oid, privilege_name)
  ),
  'public project tables expose no dangerous high-level privilege to browser roles'
);

-- Fixed fictional fixtures for real ACL + RLS execution tests.
insert into public.app_users (id, status) values
  ('8a000000-0000-4000-8000-000000000001', 'active'),
  ('8a000000-0000-4000-8000-000000000002', 'active');

insert into public.profiles (
  user_id,
  display_name,
  created_at,
  updated_at
) values
  (
    '8a000000-0000-4000-8000-000000000001',
    'Fictional ACL User A',
    '2026-01-01T00:00:00+00:00',
    '2026-01-01T00:00:00+00:00'
  ),
  (
    '8a000000-0000-4000-8000-000000000002',
    'Fictional ACL User B',
    '2026-01-01T00:00:00+00:00',
    '2026-01-01T00:00:00+00:00'
  );

insert into public.user_identities (
  user_id,
  provider,
  provider_tenant,
  provider_subject,
  verified_at
) values
  (
    '8a000000-0000-4000-8000-000000000001',
    'supabase_auth',
    'https://fictional-acl-issuer.example.invalid',
    '8a000000-0000-4000-8000-0000000000a1',
    now()
  ),
  (
    '8a000000-0000-4000-8000-000000000002',
    'supabase_auth',
    'https://fictional-acl-issuer.example.invalid',
    '8a000000-0000-4000-8000-0000000000b2',
    now()
  );

set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$ truncate table public.app_users $sql$),
  '42501',
  'authenticated TRUNCATE app_users is denied by ACL before FK/RLS behavior'
);
select is(
  pg_temp.sqlstate_of($sql$ truncate table public.profiles $sql$),
  '42501',
  'authenticated TRUNCATE profiles is denied by ACL (RLS cannot provide this boundary)'
);
reset role;

set local role anon;
select is(
  pg_temp.sqlstate_of($sql$ select * from public.app_users $sql$),
  '42501',
  'anon cannot SELECT app_users'
);
select is(
  pg_temp.sqlstate_of($sql$ select * from public.profiles $sql$),
  '42501',
  'anon cannot SELECT profiles'
);
reset role;

set local "request.jwt.claims" = '{"sub":"8a000000-0000-4000-8000-0000000000a1","iss":"https://fictional-acl-issuer.example.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.app_users where id = '8a000000-0000-4000-8000-000000000001'),
  1::bigint,
  'authenticated can SELECT their own app_users row'
);
select is(
  (select count(*) from public.app_users where id = '8a000000-0000-4000-8000-000000000002'),
  0::bigint,
  'app_users RLS still hides another user'
);
select is(
  (select count(*) from public.profiles where user_id = '8a000000-0000-4000-8000-000000000001'),
  1::bigint,
  'authenticated can SELECT their own profile'
);
select is(
  (select count(*) from public.profiles where user_id = '8a000000-0000-4000-8000-000000000002'),
  0::bigint,
  'profiles RLS still hides another profile'
);
select is(
  pg_temp.rows_affected($sql$
    update public.profiles
    set display_name = 'Fictional ACL Updated',
        avatar_url = 'https://example.invalid/avatar.png',
        organization_name = 'Fictional ACL Organization',
        title = 'Fictional ACL Title',
        contact_info = '{"channel":"fictional"}'::jsonb,
        updated_at = now()
    where user_id = '8a000000-0000-4000-8000-000000000001'
  $sql$),
  1,
  'authenticated can execute an UPDATE using all six whitelisted profile columns'
);
select is(
  pg_temp.sqlstate_of($sql$
    update public.profiles
    set user_id = '8a000000-0000-4000-8000-000000000002'
    where user_id = '8a000000-0000-4000-8000-000000000001'
  $sql$),
  '42501',
  'authenticated cannot execute UPDATE on non-whitelisted profiles.user_id'
);
reset role;
set local "request.jwt.claims" = '{}';

select ok(
  (
    select display_name = 'Fictional ACL Updated'
      and avatar_url = 'https://example.invalid/avatar.png'
      and organization_name = 'Fictional ACL Organization'
      and title = 'Fictional ACL Title'
      and contact_info = '{"channel":"fictional"}'::jsonb
      and updated_at > '2026-01-01T00:00:00+00:00'::timestamptz
    from public.profiles
    where user_id = '8a000000-0000-4000-8000-000000000001'
  ),
  'owner confirms all six-column profile UPDATE effects were persisted'
);

-- The migration never revokes service_role; assert its established broad core
-- table access remains intact for the server-side identity path.
select ok(
  (
    select bool_and(
      has_table_privilege('service_role', 'public.app_users', privilege_name)
    )
    from unnest(array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
      'MAINTAIN'
    ]::text[]) as privileges(privilege_name)
  ),
  'service_role app_users table privileges are unchanged'
);
select ok(
  (
    select bool_and(
      has_table_privilege('service_role', 'public.profiles', privilege_name)
    )
    from unnest(array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
      'MAINTAIN'
    ]::text[]) as privileges(privilege_name)
  ),
  'service_role profiles table privileges are unchanged'
);

select * from finish();
rollback;
