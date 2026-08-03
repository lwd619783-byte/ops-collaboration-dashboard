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

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.error_message_of(text) to public;
grant execute on function pg_temp.invitation_status(uuid) to public;
grant execute on function pg_temp.invitation_revoked_at(uuid) to public;

select plan(95);

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

-- Expired sent invitation: closes to revoked, then a new key can prepare.
select is(
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('b',64), 'e***@e***.invalid',
    'Fictional Re-invite', 'member', '34000000-0000-4000-8000-0000000000e1'
  )),
  'prepared',
  'an expired sent invitation stops blocking a fresh invitation'
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

-- Expired prepared invitation: closes to revoked, then a new key can prepare.
select is(
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('e2', 32), 'p2***@e***.invalid',
    'Fictional Re-invite Prepared', 'member', '34000000-0000-4000-8000-0000000000e3'
  )),
  'prepared',
  'an expired prepared invitation stops blocking a fresh invitation'
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
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('c',64), 'r***@e***.invalid',
    'Fictional Re-invite Revoked', 'member', '34000000-0000-4000-8000-0000000000f3'
  )),
  'prepared',
  'a revoked invitation does not block a later digest'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000c'),
  'revoked',
  'the revoked invitation is not modified by re-invitation'
);
select is(
  (select invitation_status::text from public.prepare_workspace_invitation(
    '21000000-0000-4000-8000-000000000001', repeat('d',64), 'f***@e***.invalid',
    'Fictional Re-invite Failed', 'member', '34000000-0000-4000-8000-0000000000f4'
  )),
  'prepared',
  'a failed invitation does not block a later digest'
);
select is(
  pg_temp.invitation_status('41000000-0000-4000-8000-00000000000d'),
  'failed',
  'the failed invitation is not modified by re-invitation'
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
      to_regprocedure('public.mark_workspace_invitation_failed(uuid,text)')
    ) and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[])
  ),
  'all workspace boundary functions are SECURITY DEFINER with closed search_path'
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
  array['avatar_url','disabled_at','display_name','joined_at','organization_name','role','status','title','user_id']::text[],
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

select * from finish();
rollback;
