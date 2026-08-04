begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception
  when others then return sqlstate::text;
end;
$function$;

create function pg_temp.error_message_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception
  when others then return sqlerrm::text;
end;
$function$;

-- SECURITY DEFINER helpers so the audit section can verify raw invitation
-- state while running as client roles (the raw tables stay client-denied).
create function pg_temp.invitation_status(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select status::text from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_revoked_at(p_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $function$
  select revoked_at from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_invitee(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select invitee_user_id::text from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_reissue_of(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select reissue_of_invitation_id::text from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_id_of(p_workspace_id uuid, p_key uuid)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select id from public.workspace_invitations
  where workspace_id = p_workspace_id and idempotency_key = p_key;
$function$;

create function pg_temp.invitation_sent_at(p_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $function$
  select sent_at from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.membership_count(p_workspace_id uuid, p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;
$function$;

create function pg_temp.membership_status_of(p_workspace_id uuid, p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select status::text from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;
$function$;

create function pg_temp.identity_count(p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.user_identities where user_id = p_user_id;
$function$;

create function pg_temp.app_user_count(p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.app_users where id = p_user_id;
$function$;

create function pg_temp.invitation_expiry(p_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $function$
  select expires_at from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_ttl_remaining(p_id uuid)
returns numeric
language sql
security definer
set search_path = ''
as $function$
  select (extract(epoch from (expires_at - pg_catalog.clock_timestamp())))::numeric
  from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.open_invitation_count(p_workspace_id uuid, p_hash text)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.workspace_invitations
  where workspace_id = p_workspace_id
    and email_hash = p_hash
    and status in ('prepared', 'sent', 'reissue_prepared');
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.error_message_of(text) to public;
grant execute on function pg_temp.invitation_status(uuid) to public;
grant execute on function pg_temp.invitation_revoked_at(uuid) to public;
grant execute on function pg_temp.invitation_invitee(uuid) to public;
grant execute on function pg_temp.invitation_reissue_of(uuid) to public;
grant execute on function pg_temp.invitation_id_of(uuid, uuid) to public;
grant execute on function pg_temp.invitation_sent_at(uuid) to public;
grant execute on function pg_temp.membership_count(uuid, uuid) to public;
grant execute on function pg_temp.membership_status_of(uuid, uuid) to public;
grant execute on function pg_temp.identity_count(uuid) to public;
grant execute on function pg_temp.app_user_count(uuid) to public;
grant execute on function pg_temp.invitation_expiry(uuid) to public;
grant execute on function pg_temp.invitation_ttl_remaining(uuid) to public;

create function pg_temp.invitation_failure_code(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select failure_code from public.workspace_invitations where id = p_id;
$function$;

create function pg_temp.invitation_count(p_workspace_id uuid, p_hash text)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.workspace_invitations
  where workspace_id = p_workspace_id
    and email_hash = p_hash;
$function$;

grant execute on function pg_temp.invitation_failure_code(uuid) to public;
grant execute on function pg_temp.open_invitation_count(uuid, text) to public;
grant execute on function pg_temp.invitation_count(uuid, text) to public;

select plan(178);

-- All users, names, tenants and email addresses below are fictional.
insert into public.app_users (id, status) values
  ('11000000-0000-4000-8000-000000000001', 'active'),
  ('11000000-0000-4000-8000-000000000002', 'active'),
  ('11000000-0000-4000-8000-000000000003', 'active'),
  ('11000000-0000-4000-8000-000000000004', 'active'),
  ('11000000-0000-4000-8000-000000000005', 'active'),
  ('11000000-0000-4000-8000-000000000006', 'active'),
  ('11000000-0000-4000-8000-000000000007', 'active'),
  ('11000000-0000-4000-8000-000000000008', 'active'),
  ('11000000-0000-4000-8000-000000000009', 'active');

insert into public.profiles (user_id, display_name, organization_name, title) values
  ('11000000-0000-4000-8000-000000000001', 'Fictional Owner A', 'Fictional Org', 'Owner'),
  ('11000000-0000-4000-8000-000000000002', 'Fictional Admin A', 'Fictional Org', 'Admin'),
  ('11000000-0000-4000-8000-000000000003', 'Fictional Admin B', 'Fictional Org', 'Admin'),
  ('11000000-0000-4000-8000-000000000004', 'Fictional Member', 'Fictional Org', 'Member'),
  ('11000000-0000-4000-8000-000000000005', 'Fictional External', 'Fictional Org', 'External'),
  ('11000000-0000-4000-8000-000000000006', 'Fictional Suspended', 'Fictional Org', 'Suspended'),
  ('11000000-0000-4000-8000-000000000007', 'Fictional Invitee', 'Fictional Org', 'Invitee'),
  ('11000000-0000-4000-8000-000000000008', 'Fictional Outsider', 'Fictional Org', 'Outsider'),
  ('11000000-0000-4000-8000-000000000009', 'Fictional Owner B', 'Fictional Org', 'Owner');

insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at
) values
  ('11000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://fixture-issuer.invalid', 'owner-a', now()),
  ('11000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://fixture-issuer.invalid', 'admin-a', now()),
  ('11000000-0000-4000-8000-000000000003', 'supabase_auth', 'https://fixture-issuer.invalid', 'admin-b', now()),
  ('11000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://fixture-issuer.invalid', 'member-a', now()),
  ('11000000-0000-4000-8000-000000000005', 'supabase_auth', 'https://fixture-issuer.invalid', 'external-a', now()),
  ('11000000-0000-4000-8000-000000000006', 'supabase_auth', 'https://fixture-issuer.invalid', 'suspended-a', now()),
  ('11000000-0000-4000-8000-000000000007', 'supabase_auth', 'https://fixture-issuer.invalid', 'invitee-a', now()),
  ('11000000-0000-4000-8000-000000000008', 'supabase_auth', 'https://fixture-issuer.invalid', 'outsider-a', now()),
  ('11000000-0000-4000-8000-000000000009', 'supabase_auth', 'https://fixture-issuer.invalid', 'owner-b', now());

insert into public.workspaces (id, name, owner_id, created_by) values
  ('21000000-0000-4000-8000-000000000001', 'Fictional Workspace A', '11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000002', 'Fictional Workspace B', '11000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000009');

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'owner', 'active', '11000000-0000-4000-8000-000000000001', now(), null),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'admin', 'active', '11000000-0000-4000-8000-000000000001', now(), null),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'admin', 'active', '11000000-0000-4000-8000-000000000001', now(), null),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'member', 'active', '11000000-0000-4000-8000-000000000001', now(), null),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000005', 'external_collaborator', 'active', '11000000-0000-4000-8000-000000000001', now(), null),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000006', 'member', 'suspended', '11000000-0000-4000-8000-000000000001', now(), now()),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000007', 'member', 'invited', '11000000-0000-4000-8000-000000000001', null, null),
  ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000009', 'owner', 'active', '11000000-0000-4000-8000-000000000009', now(), null);

-- anon cannot read any workspace object.
set local role anon;
select is(pg_temp.sqlstate_of('select * from public.workspaces'), '42501', 'anon cannot read workspaces');
select is(pg_temp.sqlstate_of('select * from public.workspace_members'), '42501', 'anon cannot read memberships');
select is(pg_temp.sqlstate_of('select * from public.workspace_invitations'), '42501', 'anon cannot read invitations');
reset role;

-- Outsiders and active members are isolated by RLS.
set local "request.jwt.claims" = '{"sub":"outsider-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.workspaces), 0::bigint, 'outsider sees no workspaces');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_workspace_members('21000000-0000-4000-8000-000000000001') $sql$), '42501', 'outsider cannot call the directory for another workspace');
reset role;

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.workspaces), 1::bigint, 'active owner reads own workspace');
select is((select count(*) from public.workspaces where id = '21000000-0000-4000-8000-000000000002'), 0::bigint, 'owner cannot read another workspace');
reset role;

set local "request.jwt.claims" = '{"sub":"admin-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_workspaces()), 1::bigint, 'active admin lists own workspace');
reset role;

set local "request.jwt.claims" = '{"sub":"member-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_workspaces()), 1::bigint, 'active member lists own workspace');
select is((select count(*) from public.list_workspace_members('21000000-0000-4000-8000-000000000001')), 5::bigint, 'member directory contains only active members');
select ok(not exists(select 1 from public.list_workspace_members('21000000-0000-4000-8000-000000000001') where status <> 'active'), 'member directory excludes invited and suspended rows');
select is(pg_temp.sqlstate_of($sql$ select * from public.workspace_members $sql$), '42501', 'member cannot read raw membership table');
select is(pg_temp.sqlstate_of($sql$ select * from public.workspace_invitations $sql$), '42501', 'member cannot read raw invitation table');
select is(pg_temp.sqlstate_of($sql$ insert into public.workspaces (name, owner_id, created_by) values ('Blocked', '11000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004') $sql$), '42501', 'browser cannot insert workspaces');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_members set role = 'admin' where workspace_id = '21000000-0000-4000-8000-000000000001' and user_id = '11000000-0000-4000-8000-000000000004' $sql$), '42501', 'browser cannot directly update memberships');
select is(pg_temp.sqlstate_of($sql$ insert into public.workspace_invitations (workspace_id,email_hash,email_hint,display_name,role,invited_by,idempotency_key,expires_at) values ('21000000-0000-4000-8000-000000000001',repeat('a',64),'x***@e***.invalid','Blocked','member','11000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000001',now()+interval '1 day') $sql$), '42501', 'browser cannot directly insert invitations');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','member') $sql$), '42501', 'member cannot change roles');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','suspended') $sql$), '42501', 'member cannot suspend another member');
reset role;

set local "request.jwt.claims" = '{"sub":"external-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','external_collaborator') $sql$), '42501', 'external collaborator cannot manage members');
reset role;

set local "request.jwt.claims" = '{"sub":"suspended-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_workspaces()), 0::bigint, 'suspended member loses workspace access immediately');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_workspace_members('21000000-0000-4000-8000-000000000001') $sql$), '42501', 'suspended member loses directory access');
reset role;

set local "request.jwt.claims" = '{"sub":"invitee-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_workspaces()), 0::bigint, 'invited member cannot read full workspace');
reset role;

-- Admin scope.
set local "request.jwt.claims" = '{"sub":"admin-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_workspace_members('21000000-0000-4000-8000-000000000001')), 7::bigint, 'admin directory includes invited and suspended members');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','member') $sql$), '42501', 'admin cannot modify owner');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','member') $sql$), '42501', 'admin cannot modify another admin');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','admin') $sql$), '42501', 'admin cannot promote a member to admin');
select is((select role::text from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','external_collaborator')), 'external_collaborator', 'admin changes member to external collaborator');
select is((select status::text from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','suspended')), 'suspended', 'admin suspends a normal member');
select is((select status::text from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','active')), 'active', 'admin re-enables a normal member');
reset role;

-- Owner scope and idempotent status operations.
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select role::text from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','member')), 'member', 'owner can revoke admin role');
select is((select role::text from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','admin')), 'admin', 'owner can grant admin role');
select is((select status::text from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','suspended')), 'suspended', 'owner can suspend an admin');
select is((select status::text from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','active')), 'active', 'owner can re-enable an admin');
select is((select status::text from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','active')), 'active', 'repeated activation is idempotent');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_status('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','suspended') $sql$), '42501', 'owner cannot suspend self');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_role('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','admin') $sql$), '42501', 'owner cannot downgrade self');

select is(
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('1',64), 'o***@e***.invalid',
    'Fictional Admin Invite', 'admin', '32000000-0000-4000-8000-000000000001'
  )),
  'prepared',
  'owner prepares an admin invitation'
);
select is(
  (select invitation_id from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('1',64), 'o***@e***.invalid',
    'Fictional Admin Invite', 'admin', '32000000-0000-4000-8000-000000000001'
  )),
  (select invitation_id from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('1',64), 'o***@e***.invalid',
    'Fictional Admin Invite', 'admin', '32000000-0000-4000-8000-000000000001'
  )),
  'same invitation idempotency key returns the existing invitation'
);
select is(
  (select should_send from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('1',64), 'o***@e***.invalid',
    'Fictional Admin Invite', 'admin', '32000000-0000-4000-8000-000000000001'
  )),
  false,
  'an idempotent retry cannot dispatch a duplicate Auth invitation'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('2',64), 'x***@e***.invalid',
    'Changed Payload', 'member', '32000000-0000-4000-8000-000000000001'
  )
$sql$), '23505', 'same idempotency key with conflicting payload is rejected');
reset role;

set local "request.jwt.claims" = '{"sub":"member-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('3',64), 'm***@e***.invalid',
    'Blocked Invite', 'member', '32000000-0000-4000-8000-000000000002'
  )
$sql$), '42501', 'member cannot prepare invitations');
reset role;

set local "request.jwt.claims" = '{"sub":"admin-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select invitation_status::text from public.prepare_workspace_invitation(
  '21000000-0000-4000-8000-000000000001', repeat('4',64), 'a***@e***.invalid',
  'Admin Member Invite', 'member', '32000000-0000-4000-8000-000000000003'
)), 'prepared', 'admin prepares a member invitation');
select pg_catalog.set_config(
  'test.admin_invitation_id',
  (select invitation_id::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('4',64), 'a***@e***.invalid',
    'Admin Member Invite', 'member', '32000000-0000-4000-8000-000000000003'
  )),
  true
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('5',64), 'a***@e***.invalid',
    'Blocked Admin Invite', 'admin', '32000000-0000-4000-8000-000000000004'
  )
$sql$), '42501', 'admin cannot prepare an admin invitation');
reset role;

-- Task 1.4 audit: trusted expiry computation. The TTL function and the raw
-- invitation table are revoked from client roles, so both are asserted as the
-- migration owner (default test identity) before switching to service_role.
select is(
  public.workspace_invitation_ttl_seconds(),
  3600,
  'business invitation TTL is aligned with the Auth email OTP expiry'
);
select ok(
  exists(
    select 1 from public.workspace_invitations
    where workspace_id = '21000000-0000-4000-8000-000000000001'
      and idempotency_key = '32000000-0000-4000-8000-000000000003'
      and extract(epoch from (expires_at - created_at)) between 3599 and 3601
  ),
  'new invitation expiry follows the configured TTL'
);
select ok(
  not exists(
    select 1 from pg_proc p,
      aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = to_regprocedure('public.workspace_invitation_ttl_seconds()')
      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      and a.privilege_type = 'EXECUTE'
  ),
  'the TTL configuration function is not executable by client roles'
);
reset role;

-- Controlled bootstrap and service-only failure compensation.
set local role service_role;
select ok(public.bootstrap_default_workspace(
  '11000000-0000-4000-8000-000000000009', '  Fictional Default Workspace  ',
  '33000000-0000-4000-8000-000000000001'
) is not null, 'service role bootstraps a default workspace');
select is(
  public.bootstrap_default_workspace(
    '11000000-0000-4000-8000-000000000009', 'Fictional Default Workspace',
    '33000000-0000-4000-8000-000000000001'
  ),
  public.bootstrap_default_workspace(
    '11000000-0000-4000-8000-000000000009', 'Fictional Default Workspace',
    '33000000-0000-4000-8000-000000000001'
  ),
  'matching bootstrap retry returns the same workspace'
);
select is(pg_temp.sqlstate_of($sql$
  select public.bootstrap_default_workspace(
    '11000000-0000-4000-8000-000000000009', 'Conflicting Default Workspace',
    '33000000-0000-4000-8000-000000000001'
  )
$sql$), '23505', 'conflicting bootstrap retry is rejected');
select is(
  public.mark_workspace_invitation_failed(
    pg_catalog.current_setting('test.admin_invitation_id')::uuid,
    'auth_invite_failed'
  )::text,
  'failed',
  'service role records a safe invitation failure category'
);
reset role;

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select public.bootstrap_default_workspace('11000000-0000-4000-8000-000000000009','Blocked','33000000-0000-4000-8000-000000000002') $sql$), '42501', 'anon cannot bootstrap a workspace');
reset role;
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.bootstrap_default_workspace('11000000-0000-4000-8000-000000000009','Blocked','33000000-0000-4000-8000-000000000003') $sql$), '42501', 'authenticated caller cannot bootstrap a workspace');
select is(pg_temp.sqlstate_of($sql$ select public.mark_workspace_invitation_failed('40000000-0000-4000-8000-000000000001','auth_invite_failed') $sql$), '42501', 'authenticated caller cannot mark invitation failure');
reset role;

-- Pending invitation and acceptance, including idempotency and ownership.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, expires_at, sent_at
) values (
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', repeat('6',64),
  'i***@e***.invalid', 'Fictional Invitee', 'member', 'sent',
  '11000000-0000-4000-8000-000000000007',
  '11000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001', now() + interval '7 days', now()
);

set local "request.jwt.claims" = '{"sub":"invitee-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_pending_workspace_invitations()), 1::bigint, 'invitee lists only own pending invitation');
select is((select membership_status::text from public.accept_workspace_invitation('41000000-0000-4000-8000-000000000001')), 'active', 'invitee accepts own valid invitation');
select ok((select already_accepted from public.accept_workspace_invitation('41000000-0000-4000-8000-000000000001')), 'repeated acceptance returns an idempotent success');
reset role;

set local "request.jwt.claims" = '{"sub":"outsider-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.accept_workspace_invitation('41000000-0000-4000-8000-000000000001') $sql$), '42501', 'user cannot accept another users invitation');
reset role;

-- Separate invited users for terminal invitation scenarios.
insert into public.app_users (id, status) values
  ('11000000-0000-4000-8000-00000000000b', 'active'),
  ('11000000-0000-4000-8000-00000000000c', 'active'),
  ('11000000-0000-4000-8000-00000000000d', 'active');
insert into public.profiles (user_id, display_name) values
  ('11000000-0000-4000-8000-00000000000b', 'Fictional Expired'),
  ('11000000-0000-4000-8000-00000000000c', 'Fictional Revoked'),
  ('11000000-0000-4000-8000-00000000000d', 'Fictional Failed');
insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at) values
  ('11000000-0000-4000-8000-00000000000b', 'supabase_auth', 'https://fixture-issuer.invalid', 'expired-a', now()),
  ('11000000-0000-4000-8000-00000000000c', 'supabase_auth', 'https://fixture-issuer.invalid', 'revoked-a', now()),
  ('11000000-0000-4000-8000-00000000000d', 'supabase_auth', 'https://fixture-issuer.invalid', 'failed-a', now());
insert into public.workspace_members (workspace_id,user_id,role,status,invited_by) values
  ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-00000000000b','member','invited','11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-00000000000c','member','invited','11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-00000000000d','member','invited','11000000-0000-4000-8000-000000000001');
insert into public.workspace_invitations (
  id,workspace_id,email_hash,email_hint,display_name,role,status,invitee_user_id,
  invited_by,idempotency_key,created_at,expires_at,sent_at,revoked_at,failed_at,failure_code
) values
  ('41000000-0000-4000-8000-00000000000b','21000000-0000-4000-8000-000000000001',repeat('b',64),'e***@e***.invalid','Expired','member','sent','11000000-0000-4000-8000-00000000000b','11000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-00000000000b',now()-interval '2 days',now()-interval '1 minute',now()-interval '1 day',null,null,null),
  ('41000000-0000-4000-8000-00000000000c','21000000-0000-4000-8000-000000000001',repeat('c',64),'r***@e***.invalid','Revoked','member','revoked','11000000-0000-4000-8000-00000000000c','11000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-00000000000c',now()-interval '1 day',now()+interval '1 day',now(),now(),null,null),
  ('41000000-0000-4000-8000-00000000000d','21000000-0000-4000-8000-000000000001',repeat('d',64),'f***@e***.invalid','Failed','member','failed','11000000-0000-4000-8000-00000000000d','11000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-00000000000d',now()-interval '1 day',now()+interval '1 day',null,null,now(),'auth_invite_failed');

set local "request.jwt.claims" = '{"sub":"expired-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.error_message_of($sql$ select * from public.accept_workspace_invitation('41000000-0000-4000-8000-00000000000b') $sql$), 'workspace_invitation_expired', 'expired invitation is rejected with a static code');
reset role;
set local "request.jwt.claims" = '{"sub":"revoked-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.accept_workspace_invitation('41000000-0000-4000-8000-00000000000c') $sql$), '55000', 'revoked invitation cannot be accepted');
reset role;
set local "request.jwt.claims" = '{"sub":"failed-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.accept_workspace_invitation('41000000-0000-4000-8000-00000000000d') $sql$), '55000', 'failed invitation cannot be accepted');
reset role;

-- Task 1.4 audit: expired open invitations are closed atomically so a fresh
-- invitation for the same digest can be prepared, while valid and terminal
-- invitations are never modified. Fixtures are inserted as the migration
-- owner (raw tables are client-denied) and state is verified through the
-- SECURITY DEFINER pg_temp helpers above.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invited_by, idempotency_key, created_at, expires_at
) values (
  '41000000-0000-4000-8000-00000000000e',
  '21000000-0000-4000-8000-000000000001', repeat('e2', 32),
  'p2***@e***.invalid', 'Fictional Expired Prepared', 'member', 'prepared',
  '11000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-0000000000e2', now() - interval '2 days', now() - interval '1 minute'
);
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, expires_at, sent_at
) values (
  '41000000-0000-4000-8000-00000000000f',
  '21000000-0000-4000-8000-000000000001', repeat('f', 64),
  'v***@e***.invalid', 'Fictional Valid Sent', 'member', 'sent',
  '11000000-0000-4000-8000-000000000007',
  '11000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-00000000000f', now() + interval '1 day', now()
);

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;

-- Expired sent invitation with a live invitee: the reissue path. The new
-- invitation is prepared as reissue_prepared, keeps the original invitee and
-- is linked to the revoked invitation it replaces.
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('b',64), 'e***@e***.invalid',
     'Expired', 'member', '34000000-0000-4000-8000-0000000000e1'
   )),
  'existing_invitee_reissue:reissue_prepared',
  'an expired sent invitation with a live invitee enters the reissue path'
);
select is(
  pg_temp.invitation_invitee(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    )
  ),
  '11000000-0000-4000-8000-00000000000b',
  'the reissue invitation keeps the original invitee_user_id'
);
select is(
  pg_temp.invitation_reissue_of(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    )
  ),
  '41000000-0000-4000-8000-00000000000b',
  'the reissue invitation links to the revoked invitation it replaces'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000b'),
  'revoked',
  'the expired sent invitation is closed to revoked'
);
select ok(
  pg_temp.invitation_revoked_at('41000000-0000-4000-8000-00000000000b') is not null,
  'the closed expired invitation records revoked_at'
);

-- Expired prepared invitation without an invitee: the plain new-user path.
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('e2', 32), 'p2***@e***.invalid',
     'Fictional Re-invite Prepared', 'member', '34000000-0000-4000-8000-0000000000e3'
   )),
  'new_auth_user_invite:prepared',
  'an expired prepared invitation without an invitee uses the new-user path'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000e'),
  'revoked',
  'the expired prepared invitation is closed to revoked'
);
select ok(
  pg_temp.invitation_revoked_at('41000000-0000-4000-8000-00000000000e') is not null,
  'the closed prepared invitation records revoked_at'
);

-- Still-valid sent invitation: still blocks the same digest.
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('f', 64), 'v***@e***.invalid',
    'Fictional Duplicate', 'member', '34000000-0000-4000-8000-0000000000f1'
  )
$sql$), '23505', 'a still-valid sent invitation blocks the same digest');
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000f'),
  'sent',
  'the still-valid sent invitation is untouched'
);

-- Accepted, failed and revoked invitations are terminal: never modified, and
-- a fresh invitation for the same digest can always be prepared afterwards.
select is(
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('6',64), 'i***@e***.invalid',
    'Fictional Re-invite Accepted', 'member', '34000000-0000-4000-8000-0000000000f2'
  )),
  'prepared',
  'an accepted invitation does not block a later digest'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-000000000001'),
  'accepted',
  'the accepted invitation is not modified by re-invitation'
);
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('c',64), 'r***@e***.invalid',
     'Fictional Re-invite Revoked', 'member', '34000000-0000-4000-8000-0000000000f3'
   )),
  'existing_invitee_reissue:reissue_prepared',
  'a revoked invitation with an invitee enters the reissue path'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000c'),
  'revoked',
  'the revoked invitation is not modified by re-invitation'
);
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('d',64), 'f***@e***.invalid',
     'Fictional Re-invite Failed', 'member', '34000000-0000-4000-8000-0000000000f4'
   )),
  'existing_invitee_reissue:reissue_prepared',
  'a recoverable failed invitation enters the reissue path'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000d'),
  'failed',
  'the failed invitation is not modified by re-invitation'
);
reset role;

-- ---------------------------------------------------------------------------
-- Task 1.4 round 2 audit: existing invitee reissue.
-- ---------------------------------------------------------------------------

-- Invitees that must NEVER enter the reissue path: suspended / merged users
-- and users whose identity was revoked.
insert into public.app_users (id, status, disabled_at, merged_into_user_id) values
  ('11000000-0000-4000-8000-0000000000a1', 'suspended', now(), null),
  ('11000000-0000-4000-8000-0000000000a2', 'merged', now(), '11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-0000000000a3', 'active', null, null);
insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at, revoked_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'supabase_auth', 'https://fixture-issuer.invalid', 'suspended-invitee', now(), null),
  ('11000000-0000-4000-8000-0000000000a2', 'supabase_auth', 'https://fixture-issuer.invalid', 'merged-invitee', now(), null),
  ('11000000-0000-4000-8000-0000000000a3', 'supabase_auth', 'https://fixture-issuer.invalid', 'revoked-invitee', now(), now());
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000a1', 'member', 'invited', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000a2', 'member', 'invited', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000a3', 'member', 'invited', '11000000-0000-4000-8000-000000000001');
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, created_at, expires_at, sent_at
) values
  ('41000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-000000000001', repeat('7', 64), 's***@e***.invalid', 'Suspended Invitee', 'member', 'sent', '11000000-0000-4000-8000-0000000000a1', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000a1', now() - interval '2 days', now() - interval '1 day', now() - interval '2 days'),
  ('41000000-0000-4000-8000-0000000000a2', '21000000-0000-4000-8000-000000000001', repeat('8', 64), 'm***@e***.invalid', 'Merged Invitee', 'member', 'sent', '11000000-0000-4000-8000-0000000000a2', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000a2', now() - interval '2 days', now() - interval '1 day', now() - interval '2 days'),
  ('41000000-0000-4000-8000-0000000000a3', '21000000-0000-4000-8000-000000000001', repeat('a', 64), 'r***@e***.invalid', 'Revoked Identity', 'member', 'sent', '11000000-0000-4000-8000-0000000000a3', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000a3', now() - interval '2 days', now() - interval '1 day', now() - interval '2 days');

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;

select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('7', 64), 's***@e***.invalid',
    'Suspended Invitee', 'member', '36000000-0000-4000-8000-0000000000a1'
  )
$sql$), '55000', 'a suspended invitee never enters the reissue path');
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-0000000000a1'),
  'sent',
  'rejecting an invalid invitee leaves the stale invitation untouched (atomic refusal)'
);
-- A merged invitee is refused the same way.
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('8', 64), 'm***@e***.invalid',
    'Merged Invitee', 'member', '36000000-0000-4000-8000-0000000000a2'
  )
$sql$), '55000', 'a merged invitee never enters the reissue path');
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-0000000000a2'),
  'sent',
  'rejecting a merged invitee leaves the stale invitation untouched'
);
-- An invitee whose identity was revoked is refused too.
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('a', 64), 'r***@e***.invalid',
    'Revoked Identity', 'member', '36000000-0000-4000-8000-0000000000a3'
  )
$sql$), '55000', 'an invitee with a revoked identity never enters the reissue path');
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-0000000000a3'),
  'sent',
  'rejecting a revoked-identity invitee leaves the stale invitation untouched'
);
-- A mismatched role on a reissue request is refused (the membership already
-- carries the original role).
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('b', 64), 'e***@e***.invalid',
    'Expired', 'external_collaborator', '34000000-0000-4000-8000-0000000000e1'
  )
$sql$), '23505', 'a reissue request with a changed role is refused');
reset role;

-- ---------------------------------------------------------------------------
-- Round 2 audit: reissue finalization, compensation and acceptance.
-- ---------------------------------------------------------------------------

-- The reissue invitation created earlier for digest repeat('b',64) (key 0e1)
-- is the subject of the finalize/accept flow below.
set local role service_role;

-- Reissue does not create a second internal user, identity or membership.
select is(
  pg_temp.app_user_count('11000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'reissue does not create a second internal user'
);
select is(
  pg_temp.identity_count('11000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'reissue does not create a second identity'
);
select is(
  pg_temp.membership_count('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'reissue does not create a second membership'
);

-- Service-only finalize moves the reissue invitation to sent and stamps it.
select is(
  public.confirm_workspace_auth_invitation_result(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    ),
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'expired-a'
  ),
  'sent',
  'the service can finalize a reissue invitation to sent'
);
select ok(
  pg_temp.invitation_sent_at(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    )
  ) is not null,
  'the finalized reissue invitation records sent_at'
);
-- Finalize is idempotent.
select is(
  public.confirm_workspace_auth_invitation_result(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    ),
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'expired-a'
  ),
  'sent',
  'finalize is idempotent for an already-sent reissue invitation'
);
-- Finalize refuses an invitation that is not in the reissue state.
select is(pg_temp.sqlstate_of($sql$
  select public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-000000000001',
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'expired-a'
  )
$sql$), '55000', 'finalize refuses an invitation that is not a reissue');
-- Finalize refuses an unknown invitation.
select is(pg_temp.sqlstate_of($sql$
  select public.confirm_workspace_auth_invitation_result(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'expired-a'
  )
$sql$), 'P0002', 'finalize refuses an unknown invitation');
-- The old invitation stays revoked and is never resurrected.
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000b'),
  'revoked',
  'the replaced invitation stays revoked after finalize'
);
reset role;

-- authenticated cannot finalize a reissue (service-only boundary).
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-00000000000b',
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'expired-a'
  )
$sql$), '42501', 'authenticated cannot finalize a reissue');
reset role;

-- Failure compensation accepts a reissue_prepared invitation: it enters the
-- failed terminal state while the membership stays invited for later recovery.
-- The fixture row is inserted as the migration owner (service_role has no raw
-- table grants); only the compensation call runs as service_role.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, expires_at,
  reissue_of_invitation_id
) values (
  '42000000-0000-4000-8000-0000000000a1',
  '21000000-0000-4000-8000-000000000001', repeat('5', 64),
  'r***@e***.invalid', 'Failed Reissue', 'member', 'reissue_prepared',
  '11000000-0000-4000-8000-00000000000c',
  '11000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-0000000000a1',
  now() + interval '1 hour',
  '41000000-0000-4000-8000-00000000000c'
);
set local role service_role;
select is(
  public.mark_workspace_invitation_failed(
    '42000000-0000-4000-8000-0000000000a1',
    'auth_invite_failed'
  ),
  'failed'::public.workspace_invitation_status,
  'a failed reissue invitation is compensated to the failed terminal state'
);
select is(
  pg_temp.membership_status_of(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000000c'
  ),
  'invited',
  'the membership stays invited after a failed reissue for later recovery'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000c'),
  'revoked',
  'the replaced invitation of a failed reissue stays revoked'
);
reset role;

-- The pending-invitation flag distinguishes valid pending invitations from
-- stale invited memberships. Digest repeat('6',64) invitation was accepted
-- earlier; digest repeat('b',64) is now a valid sent reissue; invitee 0c/0d
-- have no valid pending invitation.
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select pending_invitation from public.list_workspace_members('21000000-0000-4000-8000-000000000001')
   where user_id = '11000000-0000-4000-8000-00000000000b'),
  true,
  'an invited membership with a valid sent reissue has a pending invitation'
);
select is(
  (select pending_invitation from public.list_workspace_members('21000000-0000-4000-8000-000000000001')
   where user_id = '11000000-0000-4000-8000-00000000000c'),
  false,
  'an invited membership with no valid pending invitation reports none'
);
select is(
  (select pending_invitation from public.list_workspace_members('21000000-0000-4000-8000-000000000001')
   where user_id = '11000000-0000-4000-8000-00000000000d'),
  false,
  'a failed invitee reports no pending invitation'
);
reset role;

-- Accepting the finalized reissue activates the ORIGINAL membership.
set local "request.jwt.claims" = '{"sub":"expired-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select membership_status::text from public.accept_workspace_invitation(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    )
  )),
  'active',
  'accepting the finalized reissue activates the original membership'
);
select is(
  pg_temp.invitation_status(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000e1'
    )
  ),
  'accepted',
  'the finalized reissue invitation is accepted'
);
select is(
  pg_temp.membership_status_of(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000000b'
  ),
  'active',
  'the original membership becomes active after acceptance'
);
reset role;

-- ---------------------------------------------------------------------------
-- Task 1.4 round 3 audit: invitee lineage across reissue failures.
-- ---------------------------------------------------------------------------

-- New fixtures:
--   * 0c: active internal user with a live supabase_auth identity
--         (provider_subject 'revoked-a'), membership still invited.
--   * 0b3: active user with ONLY a non-Auth identity (no supabase_auth).
--   * Failed first invites carry NO invitee and must stay on the plain
--     new-user path.
insert into public.app_users (id, status) values
  ('11000000-0000-4000-8000-0000000000b3', 'active');
insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at) values
  ('11000000-0000-4000-8000-0000000000b3', 'wechat_miniprogram', 'fictional-tenant', 'other-provider-subject', now());
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000b3', 'member', 'invited', '11000000-0000-4000-8000-000000000001');
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, created_at, expires_at,
  sent_at, failed_at, failure_code
) values
  ('41000000-0000-4000-8000-0000000000b2', '21000000-0000-4000-8000-000000000001', repeat('b2', 32), 'u***@e***.invalid', 'Conflict Invitee', 'member', 'failed', '11000000-0000-4000-8000-00000000000c', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000b2', now() - interval '2 days', now() + interval '1 day', now() - interval '2 days', now() - interval '2 days', 'auth_user_conflict'),
  ('41000000-0000-4000-8000-0000000000b3', '21000000-0000-4000-8000-000000000001', repeat('b3', 32), 'w***@e***.invalid', 'Other Provider', 'member', 'failed', '11000000-0000-4000-8000-0000000000b3', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000b3', now() - interval '2 days', now() + interval '1 day', now() - interval '2 days', now() - interval '2 days', 'auth_invite_failed'),
  ('41000000-0000-4000-8000-0000000000b4', '21000000-0000-4000-8000-000000000001', repeat('b4', 32), 'f***@e***.invalid', 'Failed First', 'member', 'failed', null, '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-0000000000b4', now() - interval '2 days', now() + interval '1 day', null, now() - interval '2 days', 'auth_invite_failed');

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;

-- A stable auth_user_conflict failure can never be re-sent: fixed conflict,
-- no prepared row, no new identity.
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('b2', 32), 'u***@e***.invalid',
    'Conflict Invitee', 'member', '36000000-0000-4000-8000-0000000000b2'
  )
$sql$), '55000', 'an auth_user_conflict lineage returns a stable conflict');
select is(
  pg_temp.open_invitation_count(
    '21000000-0000-4000-8000-000000000001',
    repeat('b2', 32)
  ),
  0::bigint,
  'an auth_user_conflict lineage never creates a new open invitation'
);
select is(
  pg_temp.identity_count('11000000-0000-4000-8000-00000000000c'),
  1::bigint,
  'an auth_user_conflict lineage never creates a second identity'
);
-- The conflict error is static and safe (does not embed IDs).
select is(
  pg_temp.error_message_of($sql$
    select * from public.prepare_workspace_invitation(
      '21000000-0000-4000-8000-000000000001', repeat('b2', 32), 'u***@e***.invalid',
      'Conflict Invitee', 'member', '36000000-0000-4000-8000-0000000000b2'
    )
  $sql$),
  'workspace_invitation_auth_user_conflict',
  'the auth_user_conflict error text is a static safe code'
);
-- A user with ONLY a non-Auth identity cannot be reissued by email.
select is(pg_temp.sqlstate_of($sql$
  select * from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('b3', 32), 'w***@e***.invalid',
    'Other Provider', 'member', '36000000-0000-4000-8000-0000000000b3'
  )
$sql$), '55000', 'a lineage without a live supabase_auth identity is refused');
select is(
  pg_temp.open_invitation_count(
    '21000000-0000-4000-8000-000000000001',
    repeat('b3', 32)
  ),
  0::bigint,
  'a non-Auth lineage never creates an open invitation'
);
-- A failed FIRST invite without an invitee keeps the plain new-user path.
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('b4', 32), 'f***@e***.invalid',
     'Failed First', 'member', '36000000-0000-4000-8000-0000000000b4'
   )),
  'new_auth_user_invite:prepared',
  'a failed first invite without an invitee stays on the new-user path'
);
reset role;

-- ---------------------------------------------------------------------------
-- Round 3 audit: finalize verifies the Auth identity inside the transaction.
-- The digest repeat('c',64) reissue (invitee 0c, identity subject
-- 'revoked-a') was created by the round-2 revoked-lineage test and is still
-- reissue_prepared; it is the subject of the mismatch checks below.
-- ---------------------------------------------------------------------------
set local role service_role;
-- Subject mismatch: the invitation is NOT marked sent.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'wrong-subject'
    )
  $sql$),
  '55000',
  'finalize rejects a mismatched Auth subject without marking sent'
);
select is(
  pg_temp.invitation_status(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000f3'
    )
  ),
  'reissue_prepared',
  'the invitation stays reissue_prepared after a subject mismatch'
);
-- Tenant mismatch: same static failure.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      'https://unrelated.invalid',
      'revoked-a'
    )
  $sql$),
  '55000',
  'finalize rejects a mismatched provider tenant'
);
-- Matching identity finalizes successfully.
select is(
  public.confirm_workspace_auth_invitation_result(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000f3'
    ),
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'revoked-a'
  ),
  'sent',
  'finalize accepts the exact Auth subject and tenant'
);
-- Invalid/blank identity parameters are refused up front.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      '',
      'revoked-a'
    )
  $sql$),
  '22023',
  'finalize refuses blank identity parameters'
);
reset role;

-- ---------------------------------------------------------------------------
-- Round 4 audit: unified Auth outcome confirmation. The old finalize RPC is
-- gone; confirm_workspace_auth_invitation_result is the ONLY boundary that
-- may declare an Auth Admin success a business success.
-- ---------------------------------------------------------------------------

-- Fixtures for the new-auth confirmation path (simulating a completed AFTER
-- INSERT trigger):
--   * 0b4: active user with a live supabase_auth identity 'confirm-a' and an
--     invited membership in workspace 1 (role member).
--   * A sent new-auth invitation for 0b4 (digest e1) and a prepared new-auth
--     invitation WITHOUT an invitee (digest e2, Auth-user-reuse scenario).
insert into public.app_users (id, status) values
  ('11000000-0000-4000-8000-0000000000b4', 'active'),
  ('11000000-0000-4000-8000-0000000000b5', 'active');
insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at) values
  ('11000000-0000-4000-8000-0000000000b4', 'supabase_auth', 'https://fixture-issuer.invalid', 'confirm-a', now()),
  ('11000000-0000-4000-8000-0000000000b5', 'supabase_auth', 'https://fixture-issuer.invalid', 'confirm-no-member', now());
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000b4', 'member', 'invited', '11000000-0000-4000-8000-000000000001');
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, expires_at, sent_at
) values
  ('41000000-0000-4000-8000-0000000000e1', '21000000-0000-4000-8000-000000000001', repeat('f1', 32), 'n***@e***.invalid', 'Confirm Invitee', 'member', 'sent', '11000000-0000-4000-8000-0000000000b4', '11000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-0000000000e1', now() + interval '1 day', now()),
  ('41000000-0000-4000-8000-0000000000e2', '21000000-0000-4000-8000-000000000001', repeat('f2', 32), 'p***@e***.invalid', 'Prepared Confirm', 'member', 'prepared', null, '11000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-0000000000e2', now() + interval '1 day', null),
  ('41000000-0000-4000-8000-0000000000e3', '21000000-0000-4000-8000-000000000001', repeat('f3', 32), 'm***@e***.invalid', 'No Membership', 'member', 'sent', '11000000-0000-4000-8000-0000000000b5', '11000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-0000000000e3', now() + interval '1 day', now()),
  ('41000000-0000-4000-8000-0000000000e4', '21000000-0000-4000-8000-000000000001', repeat('f4', 32), 'k***@e***.invalid', 'Kind Mismatch', 'member', 'prepared', null, '11000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-0000000000e4', now() + interval '1 day', null);

set local role service_role;

-- A completed new-auth invitation (sent + invitee + identity + membership)
-- confirms successfully and is idempotent.
select is(
  public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000e1',
    'new_auth_user_invite',
    'https://fixture-issuer.invalid',
    'confirm-a'
  ),
  'sent',
  'a completed new-auth invitation confirms successfully'
);
select is(
  public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000e1',
    'new_auth_user_invite',
    'https://fixture-issuer.invalid',
    'confirm-a'
  ),
  'sent',
  'repeated confirmation of a sent invitation is idempotent'
);
-- A sent new-auth invitation whose identity subject does not match the Auth
-- Admin returned user ID is refused with a static error.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'some-other-user'
    )
  $sql$),
  '55000',
  'a sent new-auth invitation with a mismatched subject is refused'
);
-- A mismatched tenant is refused the same way.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'new_auth_user_invite',
      'https://unrelated.invalid',
      'confirm-a'
    )
  $sql$),
  '55000',
  'a sent new-auth invitation with a mismatched tenant is refused'
);
-- A sent invitation without the required invited membership is refused.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e3',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '55000',
  'a sent new-auth invitation without an invited membership is refused'
);
-- A sent invitation whose membership role does not match the invitation role
-- is refused. The role switch runs as the migration owner (service_role has
-- no raw table grants); the confirmation itself runs as service_role.
reset role;
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000b4', 'admin', 'invited', '11000000-0000-4000-8000-000000000001')
on conflict (workspace_id, user_id) do update set role = 'admin';
set local role service_role;
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '55000',
  'a sent new-auth invitation with a mismatched membership role is refused'
);
reset role;
-- Restore the matching member role for later assertions.
update public.workspace_members set role = 'member'
where workspace_id = '21000000-0000-4000-8000-000000000001'
  and user_id = '11000000-0000-4000-8000-0000000000b4';
set local role service_role;

-- A prepared new-auth invitation WITHOUT an invitee means Auth reused an
-- existing unconfirmed user: confirmation compensates it to
-- failed/auth_user_conflict and never creates a second identity/membership.
select is(
  public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000e2',
    'new_auth_user_invite',
    'https://fixture-issuer.invalid',
    'reused-user-id'
  ),
  'failed',
  'an unprovisioned prepared invitation is confirmed as a safe conflict'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-0000000000e2'),
  'failed',
  'the unprovisioned invitation is compensated to failed'
);
select is(
  pg_temp.invitation_failure_code('41000000-0000-4000-8000-0000000000e2'),
  'auth_user_conflict',
  'the compensation records auth_user_conflict'
);
select is(
  pg_temp.app_user_count('11000000-0000-4000-8000-0000000000b4'),
  1::bigint,
  'no new app user is created by the conflict compensation'
);
select is(
  pg_temp.identity_count('11000000-0000-4000-8000-0000000000b4'),
  1::bigint,
  'no second identity is created by the conflict compensation'
);
select is(
  pg_temp.membership_count(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-0000000000b4'
  ),
  1::bigint,
  'membership count is unchanged by the conflict compensation'
);
-- Repeated conflict confirmation stays 'failed' (idempotent).
select is(
  public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000e2',
    'new_auth_user_invite',
    'https://fixture-issuer.invalid',
    'reused-user-id'
  ),
  'failed',
  'repeated conflict confirmation is idempotent'
);
-- An operation kind that does not match the invitation state is refused.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e4',
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'reused-user-id'
    )
  $sql$),
  '55000',
  'an operation kind that does not match the state is refused'
);
-- The confirm error text never leaks expected/actual IDs.
select is(
  pg_temp.error_message_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'some-other-user'
    )
  $sql$),
  'workspace_invitation_identity_mismatch',
  'confirmation failures return a static safe code'
);
-- service_role cannot confirm an unrelated/unknown invitation.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  'P0002',
  'service_role cannot confirm an unknown invitation'
);
reset role;

-- authenticated cannot run the unified confirmation RPC.
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000e1',
    'new_auth_user_invite',
    'https://fixture-issuer.invalid',
    'confirm-a'
  )
$sql$), '42501', 'authenticated cannot run the unified confirmation RPC');
reset role;

-- ---------------------------------------------------------------------------
-- Round 3 audit: a recoverable failed reissue can be re-issued again with a
-- fresh key, still reusing the same invitee (never a second identity).
-- ---------------------------------------------------------------------------
-- digest repeat('d',64) failed(auth_invite_failed) invitee 0d -> the round-2
-- test already re-issued it (key 0f4, reissue_prepared). Mark that reissue
-- failed with the finalize compensation code, then prepare with a new key:
-- it must return existing_invitee_reissue again.
set local role service_role;
select is(
  public.mark_workspace_invitation_failed(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000f4'
    ),
    'temporary_failure'
  ),
  'failed'::public.workspace_invitation_status,
  'a finalize-failure compensation marks the reissue failed'
);
reset role;
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select operation_kind || ':' || invitation_status
   from public.prepare_workspace_invitation(
     '21000000-0000-4000-8000-000000000001', repeat('d', 64), 'f***@e***.invalid',
     'Fictional Re-invite Failed', 'member', '37000000-0000-4000-8000-0000000000d1'
   )),
  'existing_invitee_reissue:reissue_prepared',
  'a recoverable failed reissue can be re-issued with a fresh key'
);
select is(
  pg_temp.identity_count('11000000-0000-4000-8000-00000000000d'),
  1::bigint,
  'repeated recovery never creates a second identity'
);
select is(
  pg_temp.membership_count(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000000d'
  ),
  1::bigint,
  'repeated recovery never creates a second membership'
);
reset role;

-- ---------------------------------------------------------------------------
-- Round 2 audit: post-lock time semantics. The workspace row lock is acquired
-- BEFORE v_now is read; a request that waited across an old invitation's
-- expiry point still closes that invitation and grants the new invitation a
-- full TTL. We simulate the wait by holding the lock ourselves across the
-- expiry point (the fixture expires in the past), then calling preparation:
-- the function re-enters the already-held lock, reads a fresh v_now, closes
-- the stale invitation and computes a full TTL from that fresh time point.
-- ---------------------------------------------------------------------------
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invited_by, idempotency_key, created_at, expires_at
) values (
  '41000000-0000-4000-8000-0000000000b1',
  '21000000-0000-4000-8000-000000000002', repeat('9', 64),
  't***@e***.invalid', 'Lock Semantics', 'member', 'prepared',
  '11000000-0000-4000-8000-000000000009',
  '34000000-0000-4000-8000-0000000000b1',
  now() - interval '2 days', now() - interval '1 minute'
);
-- Hold the workspace lock across the expiry point as the migration owner
-- (SELECT ... FOR UPDATE needs table UPDATE rights the browser never has).
-- The fixture is already expired, but we also wait 2 seconds to prove the
-- time read inside prepare_workspace_invitation() happens AFTER the lock is
-- re-entered in the same transaction.
reset role;
select pg_sleep(2) from public.workspaces
where id = '21000000-0000-4000-8000-000000000002' for update;
set local "request.jwt.claims" = '{"sub":"owner-b","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select operation_kind from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000002', repeat('9', 64), 't***@e***.invalid',
    'Lock Semantics', 'member', '34000000-0000-4000-8000-0000000000b2'
  )),
  'new_auth_user_invite',
  'preparation still works after the lock wait crossed the expiry point'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-0000000000b1'),
  'revoked',
  'the expired invitation is closed after the lock wait'
);
select ok(
  pg_temp.invitation_ttl_remaining(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000002',
      '34000000-0000-4000-8000-0000000000b2'
    )
  ) between 3599 and 3601,
  'the new invitation receives a full TTL from the post-lock time point'
);
reset role;

-- Forged owner memberships can never elevate privileges: the database rejects
-- the row itself, so the permission helpers never see an owner role. The
-- constraint trigger is role-independent: the same statement-level rejection
-- applies to every writer including service_role (which has no raw table
-- grants at all).
insert into public.workspaces (id, name, owner_id, created_by) values (
  '21000000-0000-4000-8000-000000000003', 'Fictional Forged Owner',
  '11000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005'
);
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', 'owner', 'active', '11000000-0000-4000-8000-000000000005', now())
$sql$), '23514', 'a forged owner membership is rejected at the database boundary');
set local "request.jwt.claims" = '{"sub":"member-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.list_workspace_members('21000000-0000-4000-8000-000000000003')
$sql$), '42501', 'the forged user never gains directory access');
select is(
  public.is_active_workspace_member('21000000-0000-4000-8000-000000000003'),
  false,
  'the forged user never becomes an active member'
);
reset role;

-- Auth user atomic provisioning. Business role/name/workspace come from the
-- locked invitation row; forged metadata is ignored.
insert into public.workspace_invitations (
  id,workspace_id,email_hash,email_hint,display_name,role,status,invited_by,
  idempotency_key,expires_at
) values (
  '42000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to('provisioned@example.invalid','UTF8'),'sha256'),'hex'),
  'p***@e***.invalid','Database Fictional Name','external_collaborator','prepared',
  '11000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',now()+interval '7 days'
);
insert into auth.users (id,email,raw_user_meta_data,created_at,updated_at)
values (
  '51000000-0000-4000-8000-000000000001','provisioned@example.invalid',
  '{"ops_workspace_invitation_id":"42000000-0000-4000-8000-000000000001","ops_provider_tenant":"http://127.0.0.1:54321/auth/v1","display_name":"Forged Name","role":"owner","workspace_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}'::jsonb,
  now(),now()
);
select is((select status::text from public.workspace_invitations where id = '42000000-0000-4000-8000-000000000001'), 'sent', 'auth trigger moves prepared invitation to sent');
select is((select u.status::text from public.app_users u join public.workspace_invitations i on i.invitee_user_id = u.id where i.id = '42000000-0000-4000-8000-000000000001'), 'active', 'auth trigger creates an active internal app user');
select is((select p.display_name from public.profiles p join public.workspace_invitations i on i.invitee_user_id = p.user_id where i.id = '42000000-0000-4000-8000-000000000001'), 'Database Fictional Name', 'profile name comes from invitation row, not metadata');
select is((select m.role::text from public.workspace_members m join public.workspace_invitations i on i.invitee_user_id = m.user_id and i.workspace_id = m.workspace_id where i.id = '42000000-0000-4000-8000-000000000001'), 'external_collaborator', 'membership role and workspace come from invitation row');
select is((select provider_subject from public.user_identities ui join public.workspace_invitations i on i.invitee_user_id = ui.user_id where i.id = '42000000-0000-4000-8000-000000000001'), '51000000-0000-4000-8000-000000000001', 'Auth UUID is stored only as identity provider subject');

insert into public.workspace_invitations (
  id,workspace_id,email_hash,email_hint,display_name,role,status,invited_by,
  idempotency_key,expires_at
) values (
  '42000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001',
  repeat('e',64),'m***@e***.invalid','Mismatch Fictional','member','prepared',
  '11000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000002',now()+interval '7 days'
);
select is(pg_temp.error_message_of($sql$
  insert into auth.users (id,email,raw_user_meta_data,created_at,updated_at)
  values ('51000000-0000-4000-8000-000000000002','mismatch@example.invalid',
  '{"ops_workspace_invitation_id":"42000000-0000-4000-8000-000000000002","ops_provider_tenant":"http://127.0.0.1:54321/auth/v1"}'::jsonb,now(),now())
$sql$), 'workspace_invitation_provisioning_invalid', 'mismatched email digest returns only a static error');
select is((select count(*) from auth.users where id = '51000000-0000-4000-8000-000000000002'), 0::bigint, 'failed provisioning rolls back the Auth user insert');
select is((select status::text from public.workspace_invitations where id = '42000000-0000-4000-8000-000000000002'), 'prepared', 'failed provisioning leaves invitation prepared for compensation');

insert into auth.users (id,email,raw_user_meta_data,created_at,updated_at)
values ('51000000-0000-4000-8000-000000000003','unrelated@example.invalid','{}'::jsonb,now(),now());
select is((select count(*) from public.user_identities where provider_subject = '51000000-0000-4000-8000-000000000003'), 0::bigint, 'Auth insert without invitation metadata is unaffected');

select ok(
  not exists(
    select 1 from pg_proc p
    where p.oid in (
      to_regprocedure('public.is_active_workspace_member(uuid)'),
      to_regprocedure('public.workspace_role_for_current_user(uuid)'),
      to_regprocedure('public.can_manage_workspace_members(uuid)'),
      to_regprocedure('public.list_my_workspaces()'),
      to_regprocedure('public.list_workspace_members(uuid)'),
      to_regprocedure('public.list_my_pending_workspace_invitations()'),
      to_regprocedure('public.set_workspace_member_role(uuid,uuid,public.workspace_role)'),
      to_regprocedure('public.set_workspace_member_status(uuid,uuid,public.workspace_member_status)'),
      to_regprocedure('public.prepare_workspace_invitation(uuid,text,text,text,public.workspace_role,uuid)'),
      to_regprocedure('public.accept_workspace_invitation(uuid)'),
      to_regprocedure('public.bootstrap_default_workspace(uuid,text,uuid)'),
      to_regprocedure('public.mark_workspace_invitation_failed(uuid,text)'),
      to_regprocedure('public.confirm_workspace_auth_invitation_result(uuid,text,text,text)')
    ) and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[])
  ),
  'all workspace boundary functions are SECURITY DEFINER with closed search_path'
);
select ok(
  to_regprocedure('public.finalize_workspace_invitation_reissue(uuid,text,text)') is null,
  'the old finalize RPC signature is removed'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name in ('workspace_members','workspace_invitations')),
  0::bigint,
  'authenticated has no raw member or invitation table grants'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public'
     and table_name in ('workspaces','workspace_members','workspace_invitations')),
  0::bigint,
  'service_role uses controlled functions rather than broad table grants'
);
select ok(
  has_function_privilege('authenticated','public.list_my_workspaces()','execute')
  and has_function_privilege('authenticated','public.list_workspace_members(uuid)','execute')
  and has_function_privilege('authenticated','public.accept_workspace_invitation(uuid)','execute')
  and not has_function_privilege('authenticated','public.bootstrap_default_workspace(uuid,text,uuid)','execute')
  and has_function_privilege('service_role','public.bootstrap_default_workspace(uuid,text,uuid)','execute'),
  'RPC execute grants match browser and trusted-service boundaries'
);

-- Task 1.4 audit: members with a missing profile must still appear in the
-- directory with a fixed, non-sensitive display name.
insert into public.app_users (id, status) values
  ('11000000-0000-4000-8000-00000000000e', 'active'),
  ('11000000-0000-4000-8000-00000000000f', 'active');
insert into public.user_identities (user_id, provider, provider_tenant, provider_subject, verified_at) values
  ('11000000-0000-4000-8000-00000000000e', 'supabase_auth', 'https://fixture-issuer.invalid', 'profileless-owner', now()),
  ('11000000-0000-4000-8000-00000000000f', 'supabase_auth', 'https://fixture-issuer.invalid', 'profileless-member', now());
insert into public.workspaces (id, name, owner_id, created_by) values (
  '21000000-0000-4000-8000-000000000004', 'Fictional Profileless Workspace',
  '11000000-0000-4000-8000-00000000000e', '11000000-0000-4000-8000-00000000000e'
);
insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at) values
  ('21000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-00000000000e', 'owner', 'active', '11000000-0000-4000-8000-00000000000e', now()),
  ('21000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-00000000000f', 'member', 'active', '11000000-0000-4000-8000-00000000000e', now());

set local "request.jwt.claims" = '{"sub":"profileless-owner","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.list_workspace_members('21000000-0000-4000-8000-000000000004')),
  2::bigint,
  'members without a profile still appear in the directory'
);
select is(
  (select count(*) from public.list_workspace_members('21000000-0000-4000-8000-000000000004')
   where display_name = '未设置显示名称'),
  2::bigint,
  'missing profiles fall back to a fixed non-sensitive display name'
);
select ok(
  not exists(
    select 1 from public.list_workspace_members('21000000-0000-4000-8000-000000000004')
    where avatar_url is not null or organization_name is not null or title is not null
  ),
  'missing profiles keep avatar, organization and title null'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select to_jsonb(t) from public.list_workspace_members('21000000-0000-4000-8000-000000000004') as t limit 1)
  ) as k),
  array['avatar_url','disabled_at','display_name','joined_at','organization_name','pending_invitation','role','status','title','user_id']::text[],
  'the directory returns only whitelisted profile fields'
);
reset role;

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  (select display_name from public.list_workspace_members('21000000-0000-4000-8000-000000000001')
   where user_id = '11000000-0000-4000-8000-000000000001'),
  'Fictional Owner A',
  'normal profile display is preserved in the directory'
);
reset role;

-- ---------------------------------------------------------------------------
-- Round 5 audit: auth_user_conflict is a STABLE conflict (same key AND fresh
-- key, with or without an internal invitee) and confirmation is strictly
-- bound to the persisted operation kind.
-- ---------------------------------------------------------------------------

-- The prepared new-auth invitation e2 was compensated to
-- failed/auth_user_conflict by the round-4 confirmation. It has NO internal
-- invitee. A same-key prepare must raise the fixed conflict instead of
-- returning a plain failed row (which would tell the admin to re-send).
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://fixture-issuer.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$
    select * from public.prepare_workspace_invitation(
      '21000000-0000-4000-8000-000000000001', repeat('f2', 32), 'p***@e***.invalid',
      'Prepared Confirm', 'member', '38000000-0000-4000-8000-0000000000e2'
    )
  $sql$),
  '55000',
  'a same-key prepare of an auth_user_conflict raises a stable conflict'
);
select is(
  pg_temp.error_message_of($sql$
    select * from public.prepare_workspace_invitation(
      '21000000-0000-4000-8000-000000000001', repeat('f2', 32), 'p***@e***.invalid',
      'Prepared Confirm', 'member', '38000000-0000-4000-8000-0000000000e2'
    )
  $sql$),
  'workspace_invitation_auth_user_conflict',
  'the same-key conflict uses the fixed safe error code'
);
-- A FRESH key must NOT bypass the invitee-less conflict either: the stable
-- conflict guard runs before any new prepared/reissue_prepared row is
-- created, so no new invitation, no Auth Admin call, no mail.
select is(
  pg_temp.sqlstate_of($sql$
    select * from public.prepare_workspace_invitation(
      '21000000-0000-4000-8000-000000000001', repeat('f2', 32), 'p***@e***.invalid',
      'Prepared Confirm', 'member', '39000000-0000-4000-8000-0000000000e2'
    )
  $sql$),
  '55000',
  'a fresh-key prepare of an auth_user_conflict raises a stable conflict'
);
select is(
  pg_temp.error_message_of($sql$
    select * from public.prepare_workspace_invitation(
      '21000000-0000-4000-8000-000000000001', repeat('f2', 32), 'p***@e***.invalid',
      'Prepared Confirm', 'member', '39000000-0000-4000-8000-0000000000e2'
    )
  $sql$),
  'workspace_invitation_auth_user_conflict',
  'the fresh-key conflict uses the fixed safe error code'
);
select is(
  pg_temp.invitation_count(
    '21000000-0000-4000-8000-000000000001',
    repeat('f2', 32)
  ),
  1::bigint,
  'a stable conflict never creates a second invitation row'
);
select is(
  pg_temp.open_invitation_count(
    '21000000-0000-4000-8000-000000000001',
    repeat('f2', 32)
  ),
  0::bigint,
  'a stable conflict leaves no open invitation'
);
reset role;

-- ---------------------------------------------------------------------------
-- Round 5 audit: confirmation strictly binds the operation kind to the
-- persisted invitation structure.
-- ---------------------------------------------------------------------------

-- A reissue failed/auth_user_conflict fixture (reissue_of + invitee set) for
-- the kind-mismatch tests below.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, created_at, expires_at,
  sent_at, failed_at, failure_code, reissue_of_invitation_id
) values (
  '41000000-0000-4000-8000-0000000000f6', '21000000-0000-4000-8000-000000000001',
  repeat('e6', 32), 'g***@e***.invalid', 'Reissue Conflict', 'member', 'failed',
  '11000000-0000-4000-8000-00000000000c', '11000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-0000000000f6', now() - interval '2 days', now() + interval '1 day',
  now() - interval '2 days', now() - interval '1 day', 'auth_user_conflict',
  '41000000-0000-4000-8000-0000000000b3'
);

set local role service_role;

-- NULL / blank / unknown kinds are all invalid (22023) and must never fall
-- into the new-auth branch.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      null,
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '22023',
  'a NULL operation kind is refused as invalid'
);
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      '   ',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '22023',
  'a blank operation kind is refused as invalid'
);
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'unknown_kind',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '22023',
  'an unknown operation kind is refused as invalid'
);
-- A new-auth sent invitation (reissue_of is null) confirmed with the reissue
-- kind fails the structural binding.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e1',
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'confirm-a'
    )
  $sql$),
  '55000',
  'a new-auth sent invitation with the reissue kind is refused'
);
-- A reissue sent invitation (key e1 was confirmed to sent in round 4)
-- confirmed with the new-auth kind fails the structural binding.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000e1'
      ),
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'expired-a'
    )
  $sql$),
  '55000',
  'a reissue sent invitation with the new-auth kind is refused'
);
-- A new-auth failed/auth_user_conflict (e2) with the reissue kind fails.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000e2',
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'reused-user-id'
    )
  $sql$),
  '55000',
  'a new-auth conflict with the reissue kind is refused'
);
-- A reissue failed/auth_user_conflict (f6) with the new-auth kind fails.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      '41000000-0000-4000-8000-0000000000f6',
      'new_auth_user_invite',
      'https://fixture-issuer.invalid',
      'revoked-a'
    )
  $sql$),
  '55000',
  'a reissue conflict with the new-auth kind is refused'
);
-- Correct-kind idempotent confirmations still work: a sent reissue and a
-- failed reissue conflict both re-confirm with their own kind.
select is(
  public.confirm_workspace_auth_invitation_result(
    pg_temp.invitation_id_of(
      '21000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-0000000000f3'
    ),
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'revoked-a'
  ),
  'sent',
  'a correct-kind sent reissue confirmation stays idempotent'
);
select is(
  public.confirm_workspace_auth_invitation_result(
    '41000000-0000-4000-8000-0000000000f6',
    'existing_invitee_reissue',
    'https://fixture-issuer.invalid',
    'revoked-a'
  ),
  'failed',
  'a correct-kind reissue conflict confirmation stays idempotent'
);
-- Re-confirming a sent reissue with a wrong tenant or subject is refused: the
-- idempotent sent branch still validates the caller parameters.
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      'https://unrelated.invalid',
      'revoked-a'
    )
  $sql$),
  '55000',
  'a sent reissue re-confirmation with a wrong tenant is refused'
);
select is(
  pg_temp.sqlstate_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'some-other-user'
    )
  $sql$),
  '55000',
  'a sent reissue re-confirmation with a wrong subject is refused'
);
select is(
  pg_temp.error_message_of($sql$
    select public.confirm_workspace_auth_invitation_result(
      pg_temp.invitation_id_of(
        '21000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-0000000000f3'
      ),
      'existing_invitee_reissue',
      'https://fixture-issuer.invalid',
      'some-other-user'
    )
  $sql$),
  'workspace_invitation_identity_mismatch',
  'reissue confirmation failures return a static safe code'
);
reset role;

select * from finish();
rollback;