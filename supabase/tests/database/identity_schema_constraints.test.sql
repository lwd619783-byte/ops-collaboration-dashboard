begin;

create extension if not exists pgtap with schema extensions;

-- All fixtures and DDL changes live in this transaction and roll back at the
-- end. No real subjects, AppIDs, OpenIDs, phone numbers or personal data.
select plan(33);

-- ---------------------------------------------------------------------------
-- 1. Tables exist (7.1)
-- ---------------------------------------------------------------------------
select ok(to_regclass('public.app_users') is not null, 'app_users table exists');
select ok(to_regclass('public.profiles') is not null, 'profiles table exists');
select ok(to_regclass('public.user_identities') is not null, 'user_identities table exists');
select ok(to_regclass('public.identity_binding_challenges') is not null, 'identity_binding_challenges table exists');

-- ---------------------------------------------------------------------------
-- 2. Controlled enumerations exist with exact labels (7.1)
-- ---------------------------------------------------------------------------
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
-- 3. Primary keys and foreign-key delete strategies (7.1)
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
  'profiles primary key is the single user_id column');
select is(
  (select confdeltype::text from pg_constraint where conname = 'app_users_merged_into_user_id_fkey'),
  'r', 'app_users self-reference restricts deletion');
select is(
  (select confdeltype::text from pg_constraint where conname = 'profiles_user_id_fkey'),
  'c', 'profiles cascades on user deletion');
select is(
  (select confdeltype::text from pg_constraint where conname = 'user_identities_user_id_fkey'),
  'c', 'user_identities cascades on user deletion');
select is(
  (select confdeltype::text from pg_constraint where conname = 'identity_binding_challenges_target_user_id_fkey'),
  'c', 'challenges target_user_id cascades on user deletion');
select is(
  (select confdeltype::text from pg_constraint where conname = 'identity_binding_challenges_created_by_fkey'),
  'r', 'challenges created_by restricts deletion');

-- ---------------------------------------------------------------------------
-- 4. set_updated_at trigger attached and functional (7.1)
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
-- 5. user_identities unique (provider, tenant, subject) exists (7.1)
-- ---------------------------------------------------------------------------
select ok(
  exists(select 1 from pg_constraint
         where conname = 'user_identities_unique_provider_tenant_subject' and contype = 'u'),
  'user_identities unique(provider, tenant, subject) exists'
);

-- ---------------------------------------------------------------------------
-- 6. Blank tenant / subject are rejected (7.1)
-- ---------------------------------------------------------------------------
insert into public.app_users (id, status)
  values ('11111111-1111-1111-1111-111111111111', 'active');

select throws_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''   '', ''subject-x'')',
  NULL, 'blank provider_tenant is rejected');
select throws_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', '''')',
  NULL, 'blank provider_subject is rejected');

-- ---------------------------------------------------------------------------
-- 7. Invalid app_users status combinations are rejected (7.1)
-- ---------------------------------------------------------------------------
select throws_ok(
  'insert into public.app_users (id, status, merged_into_user_id)
     values (''33333333-3333-3333-3333-333333333333'', ''merged'', null)',
  NULL, 'merged without a target is rejected');
select throws_ok(
  'insert into public.app_users (id, status, merged_into_user_id)
     values (''33333333-3333-3333-3333-333333333333'', ''active'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'non-merged with a target is rejected');
select throws_ok(
  'insert into public.app_users (id, status, disabled_at)
     values (''33333333-3333-3333-3333-333333333333'', ''suspended'', null)',
  NULL, 'suspended without disabled_at is rejected');
select throws_ok(
  'insert into public.app_users (id, status, disabled_at)
     values (''33333333-3333-3333-3333-333333333333'', ''invited'', now())',
  NULL, 'invited with disabled_at is rejected');
select throws_ok(
  'insert into public.app_users (id, status, merged_into_user_id)
     values (''11111111-1111-1111-1111-111111111111'', ''merged'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'self-merge is rejected');

-- ---------------------------------------------------------------------------
-- 8. identity_binding_challenges: no raw secret column + constraint checks (7.1)
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'identity_binding_challenges'
     and column_name in ('raw_code','token','code','wechat_code','binding_code','plain_code','secret','nonce')),
  0::bigint,
  'identity_binding_challenges stores no raw challenge/code/secret column');

select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''tooshort'', now() + interval ''10 minutes'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'challenge_hash shorter than 64 chars is rejected');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'', now() - interval ''10 minutes'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'expires_at before created_at is rejected');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, attempt_count, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'', now() + interval ''10 minutes'', -1, ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'negative attempt_count is rejected');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, attempt_count, max_attempts, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'', now() + interval ''10 minutes'', 5, 2, ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'attempt_count exceeding max_attempts is rejected');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, consumed_at, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'', now() + interval ''10 minutes'', now() - interval ''5 minutes'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'consumed_at before created_at is rejected');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, consumed_at, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'', now() + interval ''10 minutes'', now() + interval ''20 minutes'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'consumed_at after expires_at is rejected');

insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
  values ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'tenant-x',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          now() + interval '10 minutes', '11111111-1111-1111-1111-111111111111');
select throws_ok(
  'insert into public.identity_binding_challenges (target_user_id, provider, provider_tenant, challenge_hash, expires_at, created_by)
     values (''11111111-1111-1111-1111-111111111111'', ''supabase_auth'', ''tenant-x'', ''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'', now() + interval ''10 minutes'', ''11111111-1111-1111-1111-111111111111'')',
  NULL, 'duplicate challenge_hash is rejected');

select * from finish();
rollback;
