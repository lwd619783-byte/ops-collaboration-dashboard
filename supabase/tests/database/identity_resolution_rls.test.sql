begin;

create extension if not exists pgtap with schema extensions;

-- Session-scoped SQLSTATE capture helper (see schema-constraints test).
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

-- All data below is fictional. No real AppID, OpenID, phone number, JWT,
-- binding code or personal information is used.
select plan(66);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the postgres owner, bypassing RLS; rolled back).
-- ---------------------------------------------------------------------------
insert into public.app_users (id, status) values
  ('11111111-1111-1111-1111-111111111111', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'invited'),
  ('66666666-6666-6666-6666-666666666666', 'active'),
  ('77777777-7777-7777-7777-777777777777', 'active');
insert into public.app_users (id, status, disabled_at) values
  ('44444444-4444-4444-4444-444444444444', 'suspended', now());
insert into public.app_users (id, status, merged_into_user_id, disabled_at) values
  ('55555555-5555-5555-5555-555555555555', 'merged', '11111111-1111-1111-1111-111111111111', now());

insert into public.profiles (user_id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Fictional User A'),
  ('22222222-2222-2222-2222-222222222222', 'Fictional User B');

insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at) values
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'https://fictional-issuer.example.local', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()),
  ('22222222-2222-2222-2222-222222222222', 'supabase_auth', 'https://fictional-issuer.example.local', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now()),
  ('33333333-3333-3333-3333-333333333333', 'supabase_auth', 'https://fictional-issuer.example.local', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now()),
  ('44444444-4444-4444-4444-444444444444', 'supabase_auth', 'https://fictional-issuer.example.local', 'dddddddd-dddd-dddd-dddd-dddddddddddd', now()),
  ('55555555-5555-5555-5555-555555555555', 'supabase_auth', 'https://fictional-issuer.example.local', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now()),
  -- Same tenant + same subject, different provider: the provider isolation pair.
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'iso_tenant', 'iso_subject', now()),
  ('22222222-2222-2222-2222-222222222222', 'wechat_miniprogram', 'iso_tenant', 'iso_subject', now()),
  -- Cross-provider / cross-tenant subject reuse pairs (used by uniqueness tests).
  ('11111111-1111-1111-1111-111111111111', 'wechat_miniprogram', 'wx_tenant', 'shared_subject_value', now()),
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'issuer_one', 'shared_subject_value_2', now()),
  -- Unverified identity: the row exists but is NOT effective.
  ('77777777-7777-7777-7777-777777777777', 'supabase_auth', 'unverified_tenant', 'unverified_subject', null),
  -- Revoked identity (revoked below, right after insert).
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'rev_tenant', 'rev_subject', now());

update public.user_identities set revoked_at = now()
  where user_id = '11111111-1111-1111-1111-111111111111'
    and provider_tenant = 'rev_tenant' and provider_subject = 'rev_subject';

-- ---------------------------------------------------------------------------
-- 7.1 Provider isolation regression.
-- With the old implementation `where i.provider = provider`, the column
-- shadowed the parameter (i.provider = i.provider, always true), so both
-- iso rows matched every provider query; at least one of the two exact
-- assertions below then had to fail. With the fix, each provider resolves to
-- its own user, and the same (tenant, subject) can coexist across providers.
-- ---------------------------------------------------------------------------
select is(
  public.resolve_app_user_id('supabase_auth', 'iso_tenant', 'iso_subject'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'supabase_auth identity resolves to user A (provider isolation)');
select is(
  public.resolve_app_user_id('wechat_miniprogram', 'iso_tenant', 'iso_subject'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'wechat_miniprogram identity resolves to user B (provider isolation)');

set local "request.jwt.claims" = '{"sub":"iso_subject","iss":"iso_tenant","role":"authenticated"}';
set local role authenticated;
select is(
  public.current_app_user_id(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'JWT with the same (iss, sub) resolves to user A via the supabase_auth provider');
reset role;
set local "request.jwt.claims" = '{}';

-- ---------------------------------------------------------------------------
-- 7.3 verified_at gating: an identity row existing does NOT mean it is
-- effective. Only verified (verified_at not null), non-revoked identities of
-- active users resolve.
-- ---------------------------------------------------------------------------
select is(
  public.resolve_app_user_id('supabase_auth', 'unverified_tenant', 'unverified_subject'),
  null::uuid,
  'unverified identity resolves to null');
update public.user_identities set verified_at = now()
  where provider_tenant = 'unverified_tenant' and provider_subject = 'unverified_subject';
select is(
  public.resolve_app_user_id('supabase_auth', 'unverified_tenant', 'unverified_subject'),
  '77777777-7777-7777-7777-777777777777'::uuid,
  'after verification the identity resolves to its user');
update public.user_identities set revoked_at = now()
  where provider_tenant = 'unverified_tenant' and provider_subject = 'unverified_subject';
select is(
  public.resolve_app_user_id('supabase_auth', 'unverified_tenant', 'unverified_subject'),
  null::uuid,
  'after revocation the identity resolves to null again');

-- ---------------------------------------------------------------------------
-- 7.2/7.3 Identity uniqueness (non-partial: revoked rows still occupy the key).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('22222222-2222-2222-2222-222222222222', 'supabase_auth',
            'https://fictional-issuer.example.local', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  $sql$),
  '23505', 'same provider+tenant+subject cannot bind a second user');
select ok(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('22222222-2222-2222-2222-222222222222', 'enterprise_wechat', 'wx_tenant', 'shared_subject_value')
  $sql$) is null,
  'different provider may reuse the same tenant+subject');
select ok(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('22222222-2222-2222-2222-222222222222', 'supabase_auth', 'issuer_two', 'shared_subject_value_2')
  $sql$) is null,
  'different tenant may reuse the same provider+subject');
select ok(
  (select count(*) from public.user_identities where user_id = '11111111-1111-1111-1111-111111111111') >= 2,
  'one internal user can hold multiple distinct identities');
select is(
  pg_temp.sqlstate_of($sql$
    insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
    values ('66666666-6666-6666-6666-666666666666', 'supabase_auth', 'rev_tenant', 'rev_subject')
  $sql$),
  '23505', 'a revoked identity cannot be rebound to another user');

-- ---------------------------------------------------------------------------
-- 7.3 Current-user resolution matrix (simulated JWT via request.jwt.claims).
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), '11111111-1111-1111-1111-111111111111'::uuid,
  'active bound supabase identity resolves to the internal app_users.id');
select ok(public.current_app_user_id() <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'resolved id is not the Auth UUID itself');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000000","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'unbound identity resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"rev_subject","iss":"rev_tenant","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'revoked identity resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'invited user resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'suspended user resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'merged user resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'missing issuer resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(public.current_app_user_id(), null::uuid, 'missing subject resolves to null');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select ok(public.current_app_user_id() = '11111111-1111-1111-1111-111111111111'::uuid
          and public.current_app_user_id() <> '22222222-2222-2222-2222-222222222222'::uuid,
  'resolution never returns a different user');
reset role;
set local "request.jwt.claims" = '{}';

-- ---------------------------------------------------------------------------
-- 7.6 RLS real denial + owner verification. We cannot conclude from A's RLS
-- view alone that B was not modified: after each mutation we reset to the
-- database owner and verify the underlying row state.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.app_users where id = '11111111-1111-1111-1111-111111111111'), 1::bigint,
  'A can read their own app_users record');
select is((select count(*) from public.app_users where id = '22222222-2222-2222-2222-222222222222'), 0::bigint,
  'A cannot read B app_users record');
select is((select count(*) from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'), 1::bigint,
  'A can read their own profile');
select is((select count(*) from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'), 0::bigint,
  'A cannot read B profile');
update public.profiles set display_name = 'OwnerVerified-NewName'
  where user_id = '11111111-1111-1111-1111-111111111111';
reset role;
set local "request.jwt.claims" = '{}';
select is(
  (select display_name from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  'OwnerVerified-NewName',
  'owner confirms A update to their own profile was really applied');

set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
update public.profiles set display_name = 'hacked'
  where user_id = '22222222-2222-2222-2222-222222222222';
reset role;
set local "request.jwt.claims" = '{}';
select is(
  (select count(*) from public.profiles
    where user_id = '22222222-2222-2222-2222-222222222222' and display_name = 'hacked'),
  0::bigint,
  'owner confirms A could not update B profile');
select is(
  (select display_name from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
  'Fictional User B',
  'owner confirms B profile is unchanged');

set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$
    update public.profiles set user_id = '22222222-2222-2222-2222-222222222222'
     where user_id = '11111111-1111-1111-1111-111111111111'
  $sql$),
  '42501', 'A cannot change their profile user_id (RLS/column privilege)');
reset role;
set local "request.jwt.claims" = '{}';

set local role anon;
select is(
  pg_temp.sqlstate_of($sql$ select * from public.app_users $sql$),
  '42501', 'anon has no business data access');
reset role;

set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$ select * from public.user_identities $sql$),
  '42501', 'authenticated cannot access user_identities');
select is(
  pg_temp.sqlstate_of($sql$ select * from public.identity_binding_challenges $sql$),
  '42501', 'authenticated cannot access identity_binding_challenges');
reset role;

set local "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.app_users where id = '44444444-4444-4444-4444-444444444444'), 0::bigint,
  'suspended user cannot read their own app_users record');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"rev_subject","iss":"rev_tenant","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.app_users where id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'revoked-identity user cannot gain access via RLS');
reset role;
set local "request.jwt.claims" = '{}';

-- ---------------------------------------------------------------------------
-- 7.5/7.7 Function metadata: volatility, definer, CLOSED search_path.
-- ---------------------------------------------------------------------------
select ok(
  (select provolatile from pg_proc where oid = to_regprocedure('public.resolve_app_user_id(public.identity_provider, text, text)')) = 's',
  'resolve_app_user_id is STABLE');
select ok(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.resolve_app_user_id(public.identity_provider, text, text)')),
  'resolve_app_user_id is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.resolve_app_user_id(public.identity_provider, text, text)')),
  array['search_path=""']::text[],
  'resolve_app_user_id uses a closed empty search_path');
select ok(
  (select provolatile from pg_proc where oid = to_regprocedure('public.current_app_user_id()')) = 's',
  'current_app_user_id is STABLE');
select ok(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.current_app_user_id()')),
  'current_app_user_id is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.current_app_user_id()')),
  array['search_path=""']::text[],
  'current_app_user_id uses a closed empty search_path');
select ok(
  not (select prosecdef from pg_proc where oid = to_regprocedure('public.user_identities_immutable()')),
  'user_identities_immutable is SECURITY INVOKER');
select ok(
  not (select prosecdef from pg_proc where oid = to_regprocedure('public.identity_binding_challenges_immutable()')),
  'identity_binding_challenges_immutable is SECURITY INVOKER');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.resolve_app_user_id(public.identity_provider, text, text)')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on resolve_app_user_id');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.current_app_user_id()')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on current_app_user_id');

set local role anon;
select is(
  pg_temp.sqlstate_of($sql$ select public.current_app_user_id() $sql$),
  '42501', 'anon cannot execute current_app_user_id');
select is(
  pg_temp.sqlstate_of($sql$ select public.user_identities_immutable() $sql$),
  '42501', 'anon cannot execute user_identities_immutable');
select is(
  pg_temp.sqlstate_of($sql$ select public.identity_binding_challenges_immutable() $sql$),
  '42501', 'anon cannot execute identity_binding_challenges_immutable');
reset role;

set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$ select public.resolve_app_user_id('supabase_auth', 't', 's') $sql$),
  '42501', 'authenticated cannot execute resolve_app_user_id');
select is(
  pg_temp.sqlstate_of($sql$ select public.user_identities_immutable() $sql$),
  '42501', 'authenticated cannot execute user_identities_immutable');
select is(
  pg_temp.sqlstate_of($sql$ select public.identity_binding_challenges_immutable() $sql$),
  '42501', 'authenticated cannot execute identity_binding_challenges_immutable');
reset role;

select ok(has_function_privilege('authenticated', 'public.current_app_user_id()', 'execute'),
  'authenticated has execute on current_app_user_id');
select ok(has_function_privilege('service_role', 'public.resolve_app_user_id(public.identity_provider, text, text)', 'execute'),
  'service_role has execute on resolve_app_user_id');

-- ---------------------------------------------------------------------------
-- 7.7 Table permission matrix via information_schema (reliable even when
-- service_role is a superuser: superuser status adds no ACL rows).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'PUBLIC' and table_schema = 'public' and table_name = 'user_identities'),
  0::bigint, 'PUBLIC has no grants on user_identities');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'PUBLIC' and table_schema = 'public' and table_name = 'identity_binding_challenges'),
  0::bigint, 'PUBLIC has no grants on identity_binding_challenges');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and table_name = 'user_identities'),
  0::bigint, 'anon has no grants on user_identities');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and table_name = 'identity_binding_challenges'),
  0::bigint, 'anon has no grants on identity_binding_challenges');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'user_identities'),
  0::bigint, 'authenticated has no grants on user_identities');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'identity_binding_challenges'),
  0::bigint, 'authenticated has no grants on identity_binding_challenges');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'user_identities'
     and privilege_type = 'DELETE'),
  0::bigint, 'service_role has no DELETE on user_identities');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'identity_binding_challenges'
     and privilege_type = 'DELETE'),
  0::bigint, 'service_role has no DELETE on identity_binding_challenges');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'user_identities'
     and privilege_type = 'SELECT'),
  1::bigint, 'service_role has SELECT on user_identities');
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'user_identities'
     and privilege_type = 'INSERT'),
  1::bigint, 'service_role has INSERT on user_identities');
select is(
  (select array_agg(column_name order by column_name)::text[] from information_schema.role_column_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'user_identities'
     and privilege_type = 'UPDATE'),
  array['last_used_at','revoked_at','verified_at']::text[],
  'service_role can UPDATE only the one-way status columns on user_identities');
select is(
  (select array_agg(column_name order by column_name)::text[] from information_schema.role_column_grants
   where grantee = 'service_role' and table_schema = 'public' and table_name = 'identity_binding_challenges'
     and privilege_type = 'UPDATE'),
  array['attempt_count','consumed_at','expires_at','max_attempts']::text[],
  'service_role can UPDATE only the state columns on identity_binding_challenges');

-- Real execution as service_role: status moves are allowed, physical deletion
-- is blocked by the trigger (the DELETE grant is absent regardless).
set local role service_role;
select ok(
  pg_temp.sqlstate_of($sql$
    update public.user_identities set revoked_at = now()
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$) is null,
  'service_role can move the one-way status fields (set revoked_at)');
select ok(
  pg_temp.sqlstate_of($sql$
    delete from public.user_identities where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$) is not null,
  'service_role cannot physically delete identity history (privilege or trigger)');
reset role;

select * from finish();
rollback;
