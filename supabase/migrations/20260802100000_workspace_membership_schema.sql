-- Task 1.4 - workspace, membership and invitation schema.
--
-- Business user references always target public.app_users.id. Supabase Auth
-- subjects and email addresses are deliberately absent from these tables.

create type public.workspace_role as enum (
  'owner',
  'admin',
  'member',
  'external_collaborator'
);

create type public.workspace_member_status as enum (
  'invited',
  'active',
  'suspended'
);

create type public.workspace_invitation_status as enum (
  'prepared',
  'sent',
  'accepted',
  'failed',
  'revoked'
);

comment on type public.workspace_role is
  'Workspace role: one owner, managed admins, members and external collaborators.';
comment on type public.workspace_member_status is
  'Workspace-local membership state. It does not change the global app_users status.';
comment on type public.workspace_invitation_status is
  'Append-only invitation lifecycle: prepared -> sent -> accepted, or a terminal failure/revocation.';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.app_users (id) on delete restrict,
  created_by uuid not null references public.app_users (id) on delete restrict,
  bootstrap_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (btrim(name) <> ''),
  constraint workspaces_name_length check (char_length(name) <= 120)
);

comment on table public.workspaces is
  'Top-level organization boundary. Physical deletion and ownership transfer are not supported.';
comment on column public.workspaces.owner_id is
  'The single owner, identified only by public.app_users.id.';
comment on column public.workspaces.bootstrap_key is
  'Server-side idempotency key for controlled default-workspace initialization.';

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  user_id uuid not null references public.app_users (id) on delete restrict,
  role public.workspace_role not null,
  status public.workspace_member_status not null,
  invited_by uuid not null references public.app_users (id) on delete restrict,
  joined_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_members_state_timestamps check (
    (status = 'invited' and joined_at is null and disabled_at is null)
    or (status = 'active' and joined_at is not null and disabled_at is null)
    or (status = 'suspended' and joined_at is not null and disabled_at is not null)
  ),
  constraint workspace_members_owner_active check (
    role <> 'owner' or status = 'active'
  )
);

create index workspace_members_user_id_idx
  on public.workspace_members (user_id, status);

comment on table public.workspace_members is
  'Workspace-local role and state. Suspension here never suspends the global app_users account.';

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_hash text not null,
  email_hint text not null,
  display_name text not null,
  role public.workspace_role not null,
  status public.workspace_invitation_status not null default 'prepared',
  invitee_user_id uuid references public.app_users (id) on delete restrict,
  invited_by uuid not null references public.app_users (id) on delete restrict,
  idempotency_key uuid not null,
  expires_at timestamptz not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  revoked_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invitations_email_hash_format
    check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint workspace_invitations_email_hint_length
    check (btrim(email_hint) <> '' and char_length(email_hint) <= 160),
  constraint workspace_invitations_display_name
    check (btrim(display_name) <> '' and char_length(display_name) <= 120),
  constraint workspace_invitations_role_not_owner
    check (role <> 'owner'),
  constraint workspace_invitations_expiry_order
    check (expires_at > created_at),
  constraint workspace_invitations_failure_code
    check (
      failure_code is null
      or failure_code in (
        'auth_invite_failed',
        'auth_user_conflict',
        'temporary_failure'
      )
    ),
  constraint workspace_invitations_state_timestamps check (
    (
      status = 'prepared'
      and invitee_user_id is null
      and sent_at is null
      and accepted_at is null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'sent'
      and invitee_user_id is not null
      and sent_at is not null
      and accepted_at is null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'accepted'
      and invitee_user_id is not null
      and sent_at is not null
      and accepted_at is not null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'failed'
      and accepted_at is null
      and failed_at is not null
      and revoked_at is null
      and failure_code is not null
    )
    or (
      status = 'revoked'
      and accepted_at is null
      and failed_at is null
      and revoked_at is not null
      and failure_code is null
    )
  ),
  constraint workspace_invitations_workspace_idempotency
    unique (workspace_id, idempotency_key)
);

create unique index workspace_invitations_one_open_email_idx
  on public.workspace_invitations (workspace_id, email_hash)
  where status in ('prepared', 'sent');

create index workspace_invitations_invitee_status_idx
  on public.workspace_invitations (invitee_user_id, status, expires_at)
  where invitee_user_id is not null;

comment on table public.workspace_invitations is
  'Server-controlled invitation history. Stores only an email digest and masked hint, never plaintext email or invite tokens.';

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();

create trigger workspace_invitations_set_updated_at
  before update on public.workspace_invitations
  for each row execute function public.set_updated_at();

create function public.workspaces_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'workspace_delete_not_supported' using errcode = '27000';
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.created_by is distinct from old.created_by
     or new.bootstrap_key is distinct from old.bootstrap_key
     or new.created_at is distinct from old.created_at
  then
    raise exception 'workspace_identity_immutable' using errcode = '27000';
  end if;

  return new;
end;
$function$;

create trigger workspaces_immutable
  before update or delete on public.workspaces
  for each row execute function public.workspaces_immutable();

create function public.workspace_members_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'workspace_member_delete_not_supported' using errcode = '27000';
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'workspace_member_identity_immutable' using errcode = '27000';
  end if;

  if old.role = 'owner'
     and (new.role is distinct from old.role or new.status is distinct from old.status)
  then
    raise exception 'workspace_owner_immutable' using errcode = '27000';
  end if;

  if old.joined_at is not null and new.joined_at is distinct from old.joined_at then
    raise exception 'workspace_member_joined_at_immutable' using errcode = '27000';
  end if;

  return new;
end;
$function$;

create trigger workspace_members_immutable
  before update or delete on public.workspace_members
  for each row execute function public.workspace_members_immutable();

create function public.workspace_invitations_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'workspace_invitation_delete_not_supported' using errcode = '27000';
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.email_hash is distinct from old.email_hash
     or new.email_hint is distinct from old.email_hint
     or new.display_name is distinct from old.display_name
     or new.role is distinct from old.role
     or new.invited_by is distinct from old.invited_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'workspace_invitation_identity_immutable' using errcode = '27000';
  end if;

  if old.invitee_user_id is not null
     and new.invitee_user_id is distinct from old.invitee_user_id
  then
    raise exception 'workspace_invitation_invitee_immutable' using errcode = '27000';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'prepared' and new.status in ('sent', 'failed', 'revoked'))
       or (old.status = 'sent' and new.status in ('accepted', 'failed', 'revoked'))
     )
  then
    raise exception 'workspace_invitation_invalid_transition' using errcode = '27000';
  end if;

  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'workspace_invitation_sent_at_immutable' using errcode = '27000';
  end if;
  if old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at then
    raise exception 'workspace_invitation_accepted_at_immutable' using errcode = '27000';
  end if;
  if old.failed_at is not null and new.failed_at is distinct from old.failed_at then
    raise exception 'workspace_invitation_failed_at_immutable' using errcode = '27000';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'workspace_invitation_revoked_at_immutable' using errcode = '27000';
  end if;

  return new;
end;
$function$;

create trigger workspace_invitations_immutable
  before update or delete on public.workspace_invitations
  for each row execute function public.workspace_invitations_immutable();

-- Deferred invariant: a workspace's owner must have the matching active owner
-- membership. Deferral lets bootstrap insert both rows atomically.
create function public.assert_workspace_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  if tg_table_name = 'workspaces' then
    v_workspace_id := coalesce(new.id, old.id);
  else
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  end if;

  if exists (
    select 1
    from public.workspaces as w
    where w.id = v_workspace_id
      and not exists (
        select 1
        from public.workspace_members as m
        where m.workspace_id = w.id
          and m.user_id = w.owner_id
          and m.role = 'owner'
          and m.status = 'active'
      )
  ) then
    raise exception 'workspace_owner_membership_required' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create constraint trigger workspaces_owner_membership_required
  after insert or update on public.workspaces
  deferrable initially deferred
  for each row execute function public.assert_workspace_owner_membership();

create constraint trigger workspace_members_owner_membership_required
  after insert or update or delete on public.workspace_members
  deferrable initially deferred
  for each row execute function public.assert_workspace_owner_membership();

revoke all on function public.workspaces_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.workspace_members_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.workspace_invitations_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_workspace_owner_membership()
  from public, anon, authenticated, service_role;
