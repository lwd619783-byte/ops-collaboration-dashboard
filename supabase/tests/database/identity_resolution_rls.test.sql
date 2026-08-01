begin;

create extension if not exists pgtap with schema extensions;

-- All data below is fictional. No real AppID, OpenID, phone number, JWT,
-- binding code or personal information is used.
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the postgres owner, bypassing RLS; rolled back).
-- ---------------------------------------------------------------------------
insert into public.app_users (id, status) values
  ('11111111-1111-1111-1111-111111111111', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'invited'),
  ('66666666-6666-6666-6666-666666666666', 'active');
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
  ('11111111-1111-1111-1111-111111111111', 'wechat_miniprogram', 'wx_fictional_appid_0001', 'wx_openid_user_a', now()),
  ('33333333-3333-3333-3333-333333333333', 'supabase_auth', 'https://fictional-issuer.example.local', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now()),
  ('44444444-4444-4444-4444-444444444444', 'supabase_auth', 'https://fictional-issuer.example.local', 'dddddddd-dddd-dddd-dddd-dddddddddddd', now()),
  ('55555555-5555-5555-5555-555555555555', 'supabase_auth', 'https://fictional-issuer.example.local', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now()),
  ('11111111-1111-1111-1111-111111111111', 'wechat_miniprogram', 'wx_tenant', 'shared_subject_value', now()),
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'issuer_one', 'shared_subject_value_2', now()),
  ('11111111-1111-1111-1111-111111111111', 'supabase_auth', 'rev_tenant', 'rev_subject', now());

update public.user_identities set revoked_at = now()
  where user_id = '11111111-1111-1111-1111-111111111111'
    and provider_tenant = 'rev_tenant' and provider_subject = 'rev_subject';

-- ---------------------------------------------------------------------------
-- 7.2 Identity uniqueness
-- ---------------------------------------------------------------------------
select throws_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''22222222-2222-2222-2222-222222222222'', ''supabase_auth'', ''https://fictional-issuer.example.local'', ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'')',
  NULL, 'same provider+tenant+subject cannot bind a second user');

select lives_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''22222222-2222-2222-2222-222222222222'', ''enterprise_wechat'', ''ec_tenant'', ''shared_subject_value'')',
  'different provider may reuse the same subject text');

select lives_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''22222222-2222-2222-2222-222222222222'', ''supabase_auth'', ''issuer_two'', ''shared_subject_value_2'')',
  'different tenant may reuse the same subject text');

select ok(
  (select count(*) from public.user_identities where user_id = '11111111-1111-1111-1111-111111111111') >= 2,
  'one internal user can hold multiple distinct identities');

select throws_ok(
  'insert into public.user_identities (user_id, provider, provider_tenant, provider_subject)
     values (''66666666-6666-6666-6666-666666666666'', ''supabase_auth'', ''rev_tenant'', ''rev_subject'')',
  NULL, 'a revoked identity cannot be rebound to another user');

-- ---------------------------------------------------------------------------
-- 7.3 Current-user resolution (simulated JWT via request.jwt.claims)
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
-- 7.4 RLS real denial (role switching + actual queries)
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
update public.profiles set display_name = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
select is((select count(*) from public.profiles where user_id = '22222222-2222-2222-2222-222222222222' and display_name = 'hacked'), 0::bigint,
  'A cannot update B profile');
reset role;
set local "request.jwt.claims" = '{}';

set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":"https://fictional-issuer.example.local","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  'update public.profiles set user_id = ''22222222-2222-2222-2222-222222222222'' where user_id = ''11111111-1111-1111-1111-111111111111''',
  NULL, 'A cannot change their profile user_id to impersonate B');
reset role;
set local "request.jwt.claims" = '{}';

set local role anon;
select throws_ok('select * from public.app_users', NULL, 'anon has no business data access');
reset role;

set local role authenticated;
select throws_ok('select * from public.user_identities', NULL, 'authenticated cannot access user_identities');
select throws_ok('select * from public.identity_binding_challenges', NULL, 'authenticated cannot access identity_binding_challenges');
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
-- 7.5 Function privilege matrix (real role execution)
-- ---------------------------------------------------------------------------
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.current_app_user_id()')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on current_app_user_id');
select ok(
  not exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public.resolve_app_user_id(public.identity_provider, text, text)')
               and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on resolve_app_user_id');

set local role anon;
select throws_ok('select public.current_app_user_id()', NULL, 'anon cannot execute current_app_user_id');
reset role;

select ok(has_function_privilege('authenticated', 'public.current_app_user_id()', 'execute'),
  'authenticated has execute on current_app_user_id');
select ok(has_function_privilege('service_role', 'public.resolve_app_user_id(public.identity_provider, text, text)', 'execute'),
  'service_role has execute on resolve_app_user_id');

set local role authenticated;
select throws_ok('select public.resolve_app_user_id(''supabase_auth'', ''t'', ''s'')', NULL,
  'authenticated cannot execute resolve_app_user_id');
reset role;

select * from finish();
rollback;
