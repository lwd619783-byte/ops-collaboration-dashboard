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

create function pg_temp.membership_status_of(p_workspace_id uuid, p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select status::text
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;
$function$;

create function pg_temp.membership_joined_at(p_workspace_id uuid, p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $function$
  select joined_at
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;
$function$;

create function pg_temp.invitation_status_of(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $function$
  select status::text from public.workspace_invitations where id = p_id;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.error_message_of(text) to public;
grant execute on function pg_temp.membership_status_of(uuid, uuid) to public;
grant execute on function pg_temp.membership_joined_at(uuid, uuid) to public;
grant execute on function pg_temp.invitation_status_of(uuid) to public;

select plan(9);

-- All identities and addresses below are fictional fixtures.
insert into public.app_users (id, status) values
  ('71000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000002', 'active'),
  ('71000000-0000-4000-8000-000000000003', 'active'),
  ('71000000-0000-4000-8000-000000000004', 'active');

insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at
) values
  ('71000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://fixture-recovery.invalid', 'recovery-owner', now()),
  ('71000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://fixture-recovery.invalid', 'recoverable-member', now()),
  ('71000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://fixture-recovery.invalid', 'no-lineage-member', now());

insert into public.workspaces (id, name, owner_id, created_by) values (
  '72000000-0000-4000-8000-000000000001',
  'Fictional Recovery Workspace',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'member', 'invited', '71000000-0000-4000-8000-000000000001', null, null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'member', 'invited', '71000000-0000-4000-8000-000000000001', null, null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', 'member', 'invited', '71000000-0000-4000-8000-000000000001', null, null);

-- Recoverable member: a previously sent invitation was revoked by reissue,
-- then the latest reissue failed with the historical Hosted user conflict.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role,
  status, invitee_user_id, invited_by, idempotency_key, expires_at,
  sent_at, revoked_at, created_at
) values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  repeat('a', 64), 'r***@e***.invalid', 'Recoverable Member', 'member',
  'revoked', '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  now() + interval '1 hour', now() - interval '2 hours',
  now() - interval '30 minutes', now() - interval '3 hours'
);

insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role,
  status, invitee_user_id, invited_by, idempotency_key, expires_at,
  failed_at, failure_code, reissue_of_invitation_id, created_at
) values (
  '73000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001',
  repeat('a', 64), 'r***@e***.invalid', 'Recoverable Member', 'member',
  'failed', '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  now() + interval '1 hour', now() - interval '20 minutes',
  'auth_user_conflict', '73000000-0000-4000-8000-000000000001',
  now() - interval '25 minutes'
);

-- Unverified member has the same recoverable-looking lineage but no verified
-- identity row; the RPC must still fail closed.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role,
  status, invitee_user_id, invited_by, idempotency_key, expires_at,
  sent_at, revoked_at, created_at
) values (
  '73000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000001',
  repeat('b', 64), 'u***@e***.invalid', 'Unverified Member', 'member',
  'revoked', '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000003',
  now() + interval '1 hour', now() - interval '2 hours',
  now() - interval '30 minutes', now() - interval '3 hours'
);

insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role,
  status, invitee_user_id, invited_by, idempotency_key, expires_at,
  failed_at, failure_code, reissue_of_invitation_id, created_at
) values (
  '73000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000001',
  repeat('b', 64), 'u***@e***.invalid', 'Unverified Member', 'member',
  'failed', '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000004',
  now() + interval '1 hour', now() - interval '20 minutes',
  'temporary_failure', '73000000-0000-4000-8000-000000000003',
  now() - interval '25 minutes'
);

-- Verified identity but no previously sent invitation in the lineage.
insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role,
  status, invitee_user_id, invited_by, idempotency_key, expires_at,
  failed_at, failure_code, created_at
) values (
  '73000000-0000-4000-8000-000000000005',
  '72000000-0000-4000-8000-000000000001',
  repeat('c', 64), 'n***@e***.invalid', 'No Lineage Member', 'member',
  'failed', '71000000-0000-4000-8000-000000000004',
  '71000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000005',
  now() + interval '1 hour', now() - interval '20 minutes',
  'auth_invite_failed', now() - interval '25 minutes'
);

set local "request.jwt.claims" = '{"sub":"recovery-owner","iss":"https://fixture-recovery.invalid","role":"authenticated"}';
set local role authenticated;

select is(
  (select status::text from public.set_workspace_member_status(
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    'active'
  )),
  'active',
  'owner explicitly recovers a verified invited member with a sent recoverable lineage'
);
select ok(
  pg_temp.membership_joined_at(
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002'
  ) is not null,
  'recovery records the first joined_at timestamp'
);
select is(
  pg_temp.invitation_status_of('73000000-0000-4000-8000-000000000001'),
  'revoked',
  'recovery does not rewrite the original invitation history'
);
select is(
  pg_temp.invitation_status_of('73000000-0000-4000-8000-000000000002'),
  'failed',
  'recovery does not rewrite the failed reissue history'
);

select is(
  pg_temp.error_message_of($sql$
    select * from public.set_workspace_member_status(
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      'active'
    )
  $sql$),
  'workspace_activation_recovery_unavailable',
  'unverified invited member cannot be recovered'
);
select is(
  pg_temp.membership_status_of(
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000003'
  ),
  'invited',
  'failed unverified recovery leaves membership invited'
);
select is(
  pg_temp.error_message_of($sql$
    select * from public.set_workspace_member_status(
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000004',
      'active'
    )
  $sql$),
  'workspace_activation_recovery_unavailable',
  'verified member without a previously sent invitation cannot be recovered'
);
select is(
  pg_temp.membership_status_of(
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000004'
  ),
  'invited',
  'failed no-lineage recovery leaves membership invited'
);
reset role;

set local "request.jwt.claims" = '{"sub":"recoverable-member","iss":"https://fixture-recovery.invalid","role":"authenticated"}';
set local role authenticated;
select is(
  pg_temp.sqlstate_of($sql$
    select * from public.set_workspace_member_status(
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      'active'
    )
  $sql$),
  '42501',
  'non-manager cannot use the recovery branch'
);
reset role;

select * from finish();
rollback;
