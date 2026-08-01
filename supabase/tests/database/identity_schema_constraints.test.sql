begin;

create extension if not exists pgtap with schema extensions;

-- Session-scoped SQLSTATE capture helper. Runs p_sql and returns its SQLSTATE
-- (or null when it succeeds), so tests can assert exact, stable error codes
-- independently of pgTAP's throws_ok message matching.
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

grant execute on function pg_temp.sqlstate_of(text) to public;

-- Row-count capture helper: runs p_sql and returns the number of affected
-- rows, or -1 when it raises. Lets "allowed" tests prove the statement really
-- hit exactly the intended row(s) instead of silently updating zero rows.
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

grant execute on function pg_temp.rows_affected(text) to public;

-- All fixtures and DDL changes live in this transaction and roll back at the
-- end. No real subjects, AppIDs, OpenIDs, phone numbers or personal data.
select plan(77);

-- ---------------------------------------------------------------------------
-- 1. Tables and controlled enumerations exist
-- ---------------------------------------------------------------------------
select ok(to_regclass('public.app_users') is not null, 'app_users table exists');
select ok(to_regclass('public.profiles') is not null, 'profiles table exists');
select ok(to_regclass('public.user_identities') is not null, 'user_identities table exists');
select ok(to_regclass('public.identity_binding_challenges') is not null, 'identity_binding_challenges table exists');
select ok(to_regtype('public.app_user_status') is not null, 'app_user_status enum exists');
select ok(to_regtype('public.identity_provider') is not null, 'identity_provider enum exists');
select is(
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'app_user_status'),
  4::bigint,
  'app_user_status has exactly four labels'
);
select is(
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'identity_provider'),
  3::bigint,
  'identity_provider has exactly three labels'
);

-- ---------------------------------------------------------------------------
-- 2. Primary keys and foreign-key delete strategies
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from pg_constraint
   where conrelid = 'public.app_users'::regclass and contype = 'p') = 1,
  'app_users has a primary key'
);
select ok(
  exists(select 1 from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
         where c.conrelid = 'public.profiles'::regclass and c.contype = 'p'
           and array_length(c.conkey, 1) = 1 and a.attname = 'user_id'),
  'profiles primary key is the single user_id column'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'app_users_merged_into_user_id_fkey'),
  'r', 'app_users self-reference restricts deletion'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'profiles_user_id_fkey'),
  'c', 'profiles cascades on user deletion'
);
-- An app_user with identity history must NOT be deletable with cascade: the
-- identity history is append-only and would otherwise be silently cleared.
select is(
  (select confdeltype::text from pg_constraint where conname = 'user_identities_user_id_fkey'),
  'r', 'user_identities user_id restricts deletion'
);
-- Both challenge user FKs must restrict: deleting the target user must never
-- cascade-remove a challenge row (challenges are append-only and carry a
-- physical-deletion trigger, so CASCADE could never complete anyway).
select is(
  (select confdeltype::text from pg_constraint where conname = 'identity_binding_challenges_target_user_id_fkey'),
  'r', 'challenges target_user_id restricts deletion'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'identity_binding_challenges_created_by_fkey'),
  'r', 'challenges created_by restricts deletion'
);

-- ---------------------------------------------------------------------------
-- 3. set_updated_at trigger attached and functional
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_trigger
   where tgrelid in (
     'public.app_users'::regclass, 'public.profiles'::regclass,
     'public.user_identities'::regclass, 'public.identity_binding_challenges'::regclass)
     and tgname like '%set_updated_at'),
  4::bigint,
  'all four tables have the set_updated_at trigger'
);

insert into public.app_users (id, status, updated_at)
  values ('44444444-4444-4444-4444-444444444444', 'invited', '2000-01-01'::timestamptz);
update public.app_users set status = 'active' where id = '44444444-4444-4444-4444-444444444444';
select ok(
  (select updated_at from public.app_users where id = '44444444-4444-4444-4444-444444444444')
    <> '2000-01-01'::timestamptz,
  'set_updated_at trigger overwrites updated_at on update'
);

-- ---------------------------------------------------------------------------
-- 4. user_identities unique (provider, tenant, subject) exists (non-partial)
-- ---------------------------------------------------------------------------
select ok(
  exists(select 1 from pg_constraint
         where conname = 'user_identities_unique_provider_tenant_subject' and contype = 'u'),
  'user_identities unique(provider, tenant, subject) exists'
);

-- ---------------------------------------------------------------------------
-- Shared fixtures for the invariant tests below.
-- ---------------------------------------------------------------------------
insert into public.app_users (id, status) values
  ('11111111-1111-1111-1111-111111111111', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'active'),
  ('88888888-8888-8888-8888-888888888888', 'invited');

insert into public.user_identities (
  id, user_id, provider, provider_tenant, provider_subject, verified_at, last_used_at
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'supabase_auth', 'tenant-x', 'subject-x',
  now(), now()
);

-- Deterministic challenge row with an explicit id so every immutability test
-- below targets a real, known row.
insert into public.identity_binding_challenges (
  id, target_user_id, provider, provider_tenant, challenge_hash, expires_at,
  attempt_count, created_by
) values (
  'd1111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  now() + interval '10 minutes', 1, '11111111-1111-1111-1111-111111111111'
);

-- ---------------------------------------------------------------------------
-- 5. Blank tenant / subject are rejected (CHECK)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', '   ', 'subject-x')
  $sql$),
  '23514', 'blank provider_tenant is rejected by a check constraint');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x', '')
  $sql$),
  '23514', 'blank provider_subject is rejected by a check constraint');

-- ---------------------------------------------------------------------------
-- 6. Invalid app_users status combinations are rejected (CHECK)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.app_users (id, status, merged_into_user_id, disabled_at)
    values ('33333333-3333-3333-3333-333333333333', 'merged', null, now())
  $sql$),
  '23514', 'merged without a target is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.app_users (id, status, merged_into_user_id)
    values ('33333333-3333-3333-3333-333333333333', 'active', '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'non-merged with a target is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.app_users (id, status)
    values ('33333333-3333-3333-3333-333333333333', 'suspended')
  $sql$),
  '23514', 'suspended without disabled_at is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.app_users (id, status, disabled_at)
    values ('33333333-3333-3333-3333-333333333333', 'invited', now())
  $sql$),
  '23514', 'invited with disabled_at is rejected');
-- Self-merge must fail on the no-self-merge CHECK, not on a primary-key
-- collision: 88888888 is inserted first, then the UPDATE points it at itself.
select is(
  pg_temp.sqlstate_of($sql$
    update public.app_users
       set status = 'merged',
           merged_into_user_id = '88888888-8888-8888-8888-888888888888',
           disabled_at = now()
     where id = '88888888-8888-8888-8888-888888888888'
  $sql$),
  '23514', 'self-merge is rejected by the no-self-merge check');

-- ---------------------------------------------------------------------------
-- 7. identity_binding_challenges: no raw secret column + constraints
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'identity_binding_challenges'
     and column_name in ('raw_code','token','code','wechat_code','binding_code','plain_code','secret','nonce')),
  0::bigint,
  'identity_binding_challenges stores no raw challenge/code/secret column'
);

select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'tooshort', now() + interval '10 minutes',
            '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'non-64-char challenge_hash is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
            now() + interval '10 minutes', '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', '64 non-hex characters are rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            now() + interval '10 minutes', '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'uppercase hex is rejected (only lowercase SHA-256 hex is allowed)');
select ok(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            now() + interval '10 minutes', '11111111-1111-1111-1111-111111111111')
  $sql$) is null,
  'lowercase 64-char hex challenge_hash is accepted');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            now() + interval '10 minutes', '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23505', 'duplicate challenge_hash is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            now() - interval '10 minutes', '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'expires_at before created_at is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at,
       attempt_count, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            now() + interval '10 minutes', -1, '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'negative attempt_count is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at,
       attempt_count, max_attempts, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            now() + interval '10 minutes', 5, 2, '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'attempt_count exceeding max_attempts is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at,
       consumed_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            now() + interval '10 minutes', now() - interval '5 minutes',
            '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'consumed_at before created_at is rejected');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.identity_binding_challenges
      (target_user_id, provider, provider_tenant, challenge_hash, expires_at,
       consumed_at, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            now() + interval '10 minutes', now() + interval '20 minutes',
            '11111111-1111-1111-1111-111111111111')
  $sql$),
  '23514', 'consumed_at after expires_at is rejected');

-- ---------------------------------------------------------------------------
-- 8. user_identities immutability / append-only guards (trigger, SQLSTATE 27000)
-- ---------------------------------------------------------------------------
select ok(to_regprocedure('public.user_identities_immutable()') is not null,
  'user_identities_immutable trigger function exists');
select ok(
  exists(select 1 from pg_trigger
         where tgrelid = 'public.user_identities'::regclass
           and tgname = 'user_identities_immutable'),
  'user_identities_immutable trigger is attached');
select ok(to_regprocedure('public.identity_binding_challenges_immutable()') is not null,
  'identity_binding_challenges_immutable trigger function exists');
select ok(
  exists(select 1 from pg_trigger
         where tgrelid = 'public.identity_binding_challenges'::regclass
           and tgname = 'identity_binding_challenges_immutable'),
  'identity_binding_challenges_immutable trigger is attached');

select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set id = gen_random_uuid()
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity id is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set user_id = '22222222-2222-2222-2222-222222222222'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity user_id (ownership) is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set provider = 'wechat_miniprogram'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity provider is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set provider_tenant = 'other-tenant'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity provider_tenant is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set provider_subject = 'other-subject'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity provider_subject is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set created_at = now() - interval '1 day'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity created_at is immutable');

-- verified_at: cannot be rewritten once set, and cannot be cleared.
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set verified_at = now() + interval '1 day'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'verified_at cannot be rewritten once set');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set verified_at = null
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'verified_at cannot be cleared once set');

-- revoked_at: null -> timestamp is allowed and must hit exactly one real row,
-- then it becomes irreversible (proven by the owner-verification below).
select is(
  pg_temp.rows_affected($sql$
    update public.user_identities set revoked_at = now()
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  1,
  'setting revoked_at updates exactly one real identity row');
select ok(
  (select revoked_at is not null from public.user_identities
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'owner confirms revoked_at was really set on the identity row');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set revoked_at = null
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'revoked_at cannot be cleared once set');
select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set revoked_at = now() + interval '1 day'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'revoked_at cannot be rewritten once set');

select is(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set last_used_at = '2000-01-01'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'last_used_at cannot move backwards');

select is(
  pg_temp.sqlstate_of($sql$
    delete from public.user_identities where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$),
  '27000', 'identity rows cannot be physically deleted');

-- Deleting an app_user with identity history is blocked by the RESTRICT FK.
select is(
  pg_temp.sqlstate_of($sql$
    delete from public.app_users where id = '11111111-1111-1111-1111-111111111111'
  $sql$),
  '23503', 'deleting an app_user with identity history is blocked by the FK');

-- ---------------------------------------------------------------------------
-- 9. identity_binding_challenges immutability / one-way-state guards
--    (all statements target the deterministic challenge row d1111111-...)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set id = gen_random_uuid()
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge id is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set challenge_hash = gen_random_uuid()::text
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge_hash is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set target_user_id = '22222222-2222-2222-2222-222222222222'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge target_user_id is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set provider = 'wechat_miniprogram'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge provider is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set provider_tenant = 'other-tenant'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge provider_tenant is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set created_by = '22222222-2222-2222-2222-222222222222'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge created_by is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set created_at = now() - interval '1 day'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge created_at is immutable');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set attempt_count = attempt_count - 1
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'attempt_count cannot decrease');
-- consumed_at: null -> timestamp allowed on exactly one real row, then
-- irreversible (proven by the owner-verification below).
select is(
  pg_temp.rows_affected($sql$
    update public.identity_binding_challenges set consumed_at = now()
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  1,
  'setting consumed_at updates exactly one real challenge row');
select ok(
  (select consumed_at is not null from public.identity_binding_challenges
    where id = 'd1111111-1111-1111-1111-111111111111'),
  'owner confirms consumed_at was really set on the challenge row');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set consumed_at = null
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'consumed_at cannot be cleared once set');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set consumed_at = now() + interval '1 hour'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'consumed_at cannot be rewritten once set');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set expires_at = now() + interval '1 day'
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'expires_at cannot be extended');
select is(
  pg_temp.sqlstate_of($sql$
    update public.identity_binding_challenges set max_attempts = max_attempts + 1
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'max_attempts cannot increase');
select is(
  pg_temp.sqlstate_of($sql$
    delete from public.identity_binding_challenges
     where id = 'd1111111-1111-1111-1111-111111111111'
  $sql$),
  '27000', 'challenge rows cannot be physically deleted');

-- ---------------------------------------------------------------------------
-- 10. Trigger functions are not executable by any client role
-- ---------------------------------------------------------------------------
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.user_identities_immutable()')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on user_identities_immutable');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.user_identities_immutable()')
               and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
               and a.privilege_type = 'EXECUTE'),
  'anon/authenticated/service_role have no execute on user_identities_immutable');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.identity_binding_challenges_immutable()')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on identity_binding_challenges_immutable');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.identity_binding_challenges_immutable()')
               and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
               and a.privilege_type = 'EXECUTE'),
  'anon/authenticated/service_role have no execute on identity_binding_challenges_immutable');

-- ---------------------------------------------------------------------------
-- 11. Real parent-record deletion behavior (not just pg_constraint metadata).
--     T is the challenge target, C a DIFFERENT creator user. Deleting T must
--     fail with 23503 because of the target FK RESTRICT — the created_by FK
--     (pointing at C, which still exists) cannot be the failing constraint.
-- ---------------------------------------------------------------------------
insert into public.app_users (id, status) values
  ('99999999-9999-9999-9999-999999999999', 'active');
insert into public.identity_binding_challenges (
  id, target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by
) values (
  'f2222222-2222-2222-2222-222222222222',
  '99999999-9999-9999-9999-999999999999', 'supabase_auth', 'tenant-x',
  '9999999999999999999999999999999999999999999999999999999999999999',
  now() + interval '10 minutes', '22222222-2222-2222-2222-222222222222'
);
select is(
  pg_temp.sqlstate_of($sql$
    delete from public.app_users where id = '99999999-9999-9999-9999-999999999999'
  $sql$),
  '23503', 'deleting the challenge target user is blocked by the target FK RESTRICT');
select is(
  (select count(*) from public.identity_binding_challenges
    where target_user_id = '99999999-9999-9999-9999-999999999999'
      and created_by = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'the challenge row survives the blocked delete (no cascade)');
select is(
  (select count(*) from public.app_users where id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'the creator user survives the blocked delete (created_by FK not implicated)');

select * from finish();
rollback;
