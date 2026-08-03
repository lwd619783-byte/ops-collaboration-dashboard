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
  when others then return -1;
end;
$function$;

create function pg_temp.owner_invariant_state()
returns text
language plpgsql
as $function$
begin
  insert into public.workspaces (id, name, owner_id, created_by)
  values (
    'f0000000-0000-4000-8000-000000000001',
    'Fictional Invalid Workspace',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  );
  set constraints workspaces_owner_membership_required immediate;
  return null;
exception
  when others then return sqlstate::text;
end;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.rows_affected(text) to public;

select plan(59);

select ok(to_regclass('public.workspaces') is not null, 'workspaces exists');
select ok(to_regclass('public.workspace_members') is not null, 'workspace_members exists');
select ok(to_regclass('public.workspace_invitations') is not null, 'workspace_invitations exists');
select ok(to_regtype('public.workspace_role') is not null, 'workspace_role exists');
select ok(to_regtype('public.workspace_member_status') is not null, 'workspace_member_status exists');
select ok(to_regtype('public.workspace_invitation_status') is not null, 'workspace_invitation_status exists');

select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'workspace_role'),
  array['owner','admin','member','external_collaborator']::text[],
  'workspace_role labels are closed and ordered'
);
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'workspace_member_status'),
  array['invited','active','suspended']::text[],
  'workspace_member_status labels are closed and ordered'
);
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'workspace_invitation_status'),
  array['prepared','sent','accepted','failed','revoked']::text[],
  'workspace_invitation_status labels are closed and ordered'
);

select is(
  (select array_length(c.conkey, 1) from pg_constraint c
   where c.conrelid = 'public.workspace_members'::regclass and c.contype = 'p'),
  2,
  'workspace_members primary key covers workspace_id and user_id'
);
select is((select confdeltype::text from pg_constraint where conname = 'workspaces_owner_id_fkey'), 'r', 'workspace owner deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspaces_created_by_fkey'), 'r', 'workspace creator deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_members_workspace_id_fkey'), 'r', 'membership workspace deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_members_user_id_fkey'), 'r', 'membership user deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_members_invited_by_fkey'), 'r', 'membership inviter deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_invitations_workspace_id_fkey'), 'r', 'invitation workspace deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_invitations_invitee_user_id_fkey'), 'r', 'invitation invitee deletion is restricted');

insert into public.app_users (id, status) values
  ('10000000-0000-4000-8000-000000000001', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'active');
insert into public.profiles (user_id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Fictional Owner'),
  ('10000000-0000-4000-8000-000000000002', 'Fictional Member'),
  ('10000000-0000-4000-8000-000000000003', 'Fictional Invitee');

insert into public.workspaces (id, name, owner_id, created_by, bootstrap_key)
values (
  '20000000-0000-4000-8000-000000000001',
  'Fictional Workspace',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'owner', 'active',
  '10000000-0000-4000-8000-000000000001', now()
), (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'member', 'active',
  '10000000-0000-4000-8000-000000000001', now()
);

select is(pg_temp.sqlstate_of($sql$
  insert into public.workspaces (name, owner_id, created_by)
  values ('   ', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')
$sql$), '23514', 'blank workspace names are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspaces (name, owner_id, created_by)
  values (repeat('x', 121), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')
$sql$), '23514', 'workspace names longer than 120 are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'member', 'active', '10000000-0000-4000-8000-000000000001', now())
$sql$), '23505', 'duplicate workspace membership is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member', 'active', '10000000-0000-4000-8000-000000000001')
$sql$), '23514', 'active membership requires joined_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member', 'invited', '10000000-0000-4000-8000-000000000001', now())
$sql$), '23514', 'invited membership cannot forge joined_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member', 'suspended', '10000000-0000-4000-8000-000000000001', now())
$sql$), '23514', 'suspended membership requires disabled_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'owner', 'invited', '10000000-0000-4000-8000-000000000001')
$sql$), '23514', 'owner membership must be active');

insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, invited_by,
  idempotency_key, expires_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  repeat('a', 64), 'i***@e***.invalid', 'Fictional Invitee', 'member',
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', now() + interval '7 days'
);

select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', 'abc', 'x***@e***.invalid', 'Fictional', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', now() + interval '1 day')
$sql$), '23514', 'short email digest is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('A',64), 'x***@e***.invalid', 'Fictional', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', now() + interval '1 day')
$sql$), '23514', 'uppercase email digest is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('b',64), 'x***@e***.invalid', 'Fictional', 'owner', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', now() + interval '1 day')
$sql$), '23514', 'owner invitation is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('b',64), 'x***@e***.invalid', 'Fictional', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', now() - interval '1 day')
$sql$), '23514', 'invitation expiry must follow creation');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, status, invited_by, idempotency_key, expires_at, sent_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('b',64), 'x***@e***.invalid', 'Fictional', 'member', 'prepared', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000006', now() + interval '1 day', now())
$sql$), '23514', 'prepared invitation cannot have sent_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('b',64), 'x***@e***.invalid', 'Fictional', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', now() + interval '1 day')
$sql$), '23505', 'workspace and idempotency key are unique');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('a',64), 'x***@e***.invalid', 'Fictional', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000007', now() + interval '1 day')
$sql$), '23505', 'only one open invitation exists per workspace and email digest');

insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, status,
  invitee_user_id, invited_by, idempotency_key, expires_at, sent_at, accepted_at
) values (
  '40000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001', repeat('c',64),
  'i***@e***.invalid', 'Fictional Accepted', 'member', 'accepted',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000008', now() + interval '1 day', now(), now()
);
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_invitations (workspace_id, email_hash, email_hint, display_name, role, invited_by, idempotency_key, expires_at)
  values ('20000000-0000-4000-8000-000000000001', repeat('c',64), 'x***@e***.invalid', 'Fictional Retry', 'member', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000009', now() + interval '1 day')
$sql$), null::text, 'terminal invitations do not block a later prepared digest');

select is(pg_temp.sqlstate_of($sql$ update public.workspaces set owner_id = '10000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000001' $sql$), '27000', 'workspace owner is immutable');
select is(pg_temp.sqlstate_of($sql$ delete from public.workspaces where id = '20000000-0000-4000-8000-000000000001' $sql$), '27000', 'workspace cannot be physically deleted');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_members set user_id = '10000000-0000-4000-8000-000000000003' where workspace_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000002' $sql$), '27000', 'membership key is immutable');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_members set invited_by = '10000000-0000-4000-8000-000000000002' where workspace_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000002' $sql$), '27000', 'membership inviter is immutable');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_members set role = 'admin' where workspace_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001' $sql$), '27000', 'owner membership role is immutable');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_members set joined_at = now() + interval '1 minute' where workspace_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000002' $sql$), '27000', 'joined_at is immutable once set');
select is(pg_temp.sqlstate_of($sql$ delete from public.workspace_members where workspace_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000002' $sql$), '27000', 'membership cannot be physically deleted');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_invitations set email_hash = repeat('d',64) where id = '40000000-0000-4000-8000-000000000001' $sql$), '27000', 'invitation digest is immutable');
select is(pg_temp.sqlstate_of($sql$ update public.workspace_invitations set status = 'accepted', invitee_user_id = '10000000-0000-4000-8000-000000000003', sent_at = now(), accepted_at = now() where id = '40000000-0000-4000-8000-000000000001' $sql$), '27000', 'prepared invitation cannot jump to accepted');

insert into public.workspace_invitations (
  id, workspace_id, email_hash, email_hint, display_name, role, invited_by,
  idempotency_key, expires_at
) values (
  '40000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001', repeat('d',64),
  'd***@e***.invalid', 'Fictional Sent', 'member',
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000010', now() + interval '1 day'
);
select is(pg_temp.rows_affected($sql$
  update public.workspace_invitations
  set status = 'sent', invitee_user_id = '10000000-0000-4000-8000-000000000003', sent_at = now()
  where id = '40000000-0000-4000-8000-000000000003'
$sql$), 1, 'prepared to sent transition updates one row');
select is(pg_temp.sqlstate_of($sql$
  update public.workspace_invitations
  set status = 'prepared', invitee_user_id = null, sent_at = null
  where id = '40000000-0000-4000-8000-000000000003'
$sql$), '27000', 'sent invitation cannot move backwards');
select is(pg_temp.sqlstate_of($sql$ delete from public.workspace_invitations where id = '40000000-0000-4000-8000-000000000003' $sql$), '27000', 'invitation history cannot be physically deleted');

select ok(
  not exists(
    select 1 from pg_proc p,
      aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in (
      to_regprocedure('public.workspaces_immutable()'),
      to_regprocedure('public.workspace_members_immutable()'),
      to_regprocedure('public.workspace_invitations_immutable()'),
      to_regprocedure('public.assert_workspace_owner_membership()'),
      to_regprocedure('public.assert_workspace_owner_user_id()')
    )
      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      and a.privilege_type = 'EXECUTE'
  ),
  'trigger functions are not executable by client roles'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']::text[]
   from pg_proc p
   where p.oid = to_regprocedure('public.assert_workspace_owner_membership()')),
  'deferred owner invariant uses a closed SECURITY DEFINER boundary for Auth transactions'
);
select is(pg_temp.owner_invariant_state(), '23514', 'workspace requires a matching active owner membership');
select ok(
  exists(
    select 1 from public.workspace_members m join public.workspaces w
      on w.id = m.workspace_id and w.owner_id = m.user_id
    where w.id = '20000000-0000-4000-8000-000000000001'
      and m.role = 'owner' and m.status = 'active'
  ),
  'valid workspace owner membership is present'
);
select is(
  (select count(*) from pg_trigger
   where tgrelid in (
     'public.workspaces'::regclass,
     'public.workspace_members'::regclass,
     'public.workspace_invitations'::regclass
   ) and tgname like '%set_updated_at'),
  3::bigint,
  'all workspace tables maintain updated_at'
);
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspaces (name, owner_id, created_by, bootstrap_key)
  values ('Fictional Duplicate Bootstrap', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001')
$sql$), '23505', 'bootstrap key is unique');

-- Task 1.4 audit: single-owner invariants.
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'workspace_members'
      and indexname = 'workspace_members_one_owner_idx'
  ),
  'workspace_members has a partial unique owner index'
);
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'owner', 'active', '10000000-0000-4000-8000-000000000001', now())
$sql$), '23505', 'a second owner membership is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspaces (id, name, owner_id, created_by)
  values ('20000000-0000-4000-8000-000000000002', 'Fictional Mismatched Owner', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002')
$sql$), null::text, 'a workspace row may be inserted before its deferred owner membership check');
select is(pg_temp.sqlstate_of($sql$
  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by, joined_at)
  values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'owner', 'active', '10000000-0000-4000-8000-000000000003', now())
$sql$), '23514', 'the sole owner membership must match workspaces.owner_id');
select is(pg_temp.sqlstate_of($sql$
  update public.workspace_members set role = 'owner'
  where workspace_id = '20000000-0000-4000-8000-000000000001'
    and user_id = '10000000-0000-4000-8000-000000000002'
$sql$), '23505', 'a normal member cannot be promoted to owner (unique owner index)');

-- Task 1.4 audit: server-side invitation TTL.
select ok(
  to_regprocedure('public.workspace_invitation_ttl_seconds()') is not null,
  'workspace invitation TTL function exists'
);
select is(
  public.workspace_invitation_ttl_seconds(),
  3600,
  'business invitation TTL is aligned with the Auth email OTP expiry'
);
select ok(
  to_regprocedure('public.prepare_workspace_invitation(uuid,text,text,text,public.workspace_role,uuid)') is not null,
  'preparation RPC no longer accepts a browser-supplied expiry'
);
select ok(
  to_regprocedure('public.prepare_workspace_invitation(uuid,text,text,text,public.workspace_role,uuid,timestamptz)') is null,
  'the old preparation signature accepting p_expires_at is removed'
);

select * from finish();
rollback;
