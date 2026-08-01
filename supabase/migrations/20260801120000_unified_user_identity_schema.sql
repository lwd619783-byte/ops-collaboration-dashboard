-- Task 1.2 — Unified system user and multi-identity data model (schema).
--
-- This migration establishes the controlled, versioned schema only. Functions,
-- row-level security policies and privilege grants live in the companion
-- migration 20260801120100_unified_user_identity_security.sql.
--
-- Design invariants (all data is fictional in tests; no real subjects here):
--   * app_users.id is the single stable internal business user identifier.
--   * External subjects (Supabase Auth UUID, WeChat OpenID/UnionID, Enterprise
--     WeChat ids) are NEVER used as business keys and live only in
--     user_identities.
--   * Business tables must reference app_users.id, never an external id.

-- ---------------------------------------------------------------------------
-- Controlled enumerations (stronger than free-text provider/status columns).
-- ---------------------------------------------------------------------------

create type public.app_user_status as enum (
  'invited',
  'active',
  'suspended',
  'merged'
);

comment on type public.app_user_status is
  'Lifecycle state of an internal business user. invited -> active -> (suspended | merged).';

create type public.identity_provider as enum (
  'supabase_auth',
  'wechat_miniprogram',
  'enterprise_wechat'
);

comment on type public.identity_provider is
  'Trusted external identity source. Values are closed; new channels require a reviewed migration.';

-- ---------------------------------------------------------------------------
-- app_users: the internal, stable business user.
-- ---------------------------------------------------------------------------

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  status public.app_user_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  merged_into_user_id uuid references public.app_users (id) on delete restrict,
  -- A user may never merge into itself.
  constraint app_users_no_self_merge
    check (merged_into_user_id is null or merged_into_user_id <> id),
  -- merged IFF a target is recorded (no silent, partial merges).
  constraint app_users_merged_requires_target
    check ((status = 'merged') = (merged_into_user_id is not null)),
  -- Only suspended/merged carry a disable time; invited/active must not.
  constraint app_users_disabled_consistency
    check (
      (status in ('suspended', 'merged') and disabled_at is not null)
      or (status in ('invited', 'active') and disabled_at is null)
    )
);

comment on table public.app_users is
  'Internal business users. The ONLY stable user key for business tables.';
comment on column public.app_users.id is 'Internal business user id (never an external subject).';
comment on column public.app_users.merged_into_user_id is
  'Survivor when this record was merged; null unless status = merged.';

-- ---------------------------------------------------------------------------
-- profiles: public-facing user profile, decoupled from any login identity.
-- No passwords, email-verification tokens, OpenIDs or auth sessions.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  organization_name text,
  title text,
  contact_info jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_not_blank
    check (btrim(display_name) <> ''),
  constraint profiles_display_name_length
    check (char_length(display_name) <= 120),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint profiles_organization_length
    check (organization_name is null or char_length(organization_name) <= 200),
  constraint profiles_title_length
    check (title is null or char_length(title) <= 200),
  constraint profiles_contact_info_object
    check (contact_info is null or jsonb_typeof(contact_info) = 'object')
);

comment on table public.profiles is
  'Public profile for an internal user. One-to-one with app_users, decoupled from login.';
comment on column public.profiles.contact_info is
  'Optional JSONB object only; must never hold raw personal identifiers in practice.';

-- ---------------------------------------------------------------------------
-- user_identities: external subject -> internal user mapping.
-- Revocation is logical (revoked_at); rows are never physically deleted so a
-- subject can never be silently rebound to a different internal user.
-- ---------------------------------------------------------------------------

create table public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  provider public.identity_provider not null,
  provider_tenant text not null,
  provider_subject text not null,
  verified_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint user_identities_tenant_not_blank
    check (btrim(provider_tenant) <> ''),
  constraint user_identities_subject_not_blank
    check (btrim(provider_subject) <> ''),
  constraint user_identities_verified_after_created
    check (verified_at is null or verified_at >= created_at),
  constraint user_identities_last_used_after_created
    check (last_used_at is null or last_used_at >= created_at),
  constraint user_identities_revoked_after_created
    check (revoked_at is null or revoked_at >= created_at),
  -- Non-partial: revoked rows still participate, so the same external identity
  -- can never be bound to two internal users.
  constraint user_identities_unique_provider_tenant_subject
    unique (provider, provider_tenant, provider_subject)
);

create index user_identities_user_id_idx on public.user_identities (user_id);

comment on table public.user_identities is
  'Maps an external (provider, tenant, subject) to an internal app_users.id. Never physically deleted.';
comment on column public.user_identities.provider_tenant is
  'Identity domain, e.g. a JWT issuer or a WeChat AppID domain. Never blank.';
comment on column public.user_identities.provider_subject is
  'Stable external principal id within the tenant (e.g. auth uid, OpenID). Never blank.';

-- ---------------------------------------------------------------------------
-- identity_binding_challenges: server-side-only one-time binding challenges.
-- Only irreversible digests are stored; no raw codes/tokens/wechat codes.
-- ---------------------------------------------------------------------------

create table public.identity_binding_challenges (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.app_users (id) on delete cascade,
  provider public.identity_provider not null,
  provider_tenant text not null,
  challenge_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  created_by uuid not null references public.app_users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_binding_challenges_tenant_not_blank
    check (btrim(provider_tenant) <> ''),
  constraint identity_binding_challenges_hash_length
    check (char_length(challenge_hash) = 64),
  constraint identity_binding_challenges_hash_unique
    unique (challenge_hash),
  constraint identity_binding_challenges_expires_after_created
    check (expires_at > created_at),
  constraint identity_binding_challenges_consumed_order
    check (consumed_at is null or (consumed_at >= created_at and consumed_at <= expires_at)),
  constraint identity_binding_challenges_attempt_count_range
    check (attempt_count >= 0 and attempt_count <= max_attempts),
  constraint identity_binding_challenges_max_attempts_positive
    check (max_attempts > 0)
);

comment on table public.identity_binding_challenges is
  'Server-side one-time account-binding challenges. Stores only SHA-256 digests; no raw secrets.';
comment on column public.identity_binding_challenges.challenge_hash is
  'SHA-256 hex digest (64 chars) of the binding challenge; the raw value is never persisted.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance via the existing Task 1.1 trigger function.
-- set_updated_at() is security invoker, search_path = pg_catalog, and must be
-- attached explicitly per table.
-- ---------------------------------------------------------------------------

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger user_identities_set_updated_at
  before update on public.user_identities
  for each row execute function public.set_updated_at();

create trigger identity_binding_challenges_set_updated_at
  before update on public.identity_binding_challenges
  for each row execute function public.set_updated_at();
