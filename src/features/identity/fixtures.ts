/**
 * Fictional test fixtures for the unified user / multi-identity data model.
 *
 * These values exist ONLY for unit tests. They contain no real people, units,
 * AppIDs, OpenIDs, phone numbers, JWTs, binding codes or secrets. All UUIDs are
 * deterministic, lowercase, valid hex test values (each is globally unique and
 * never embeds a "fictional" text marker); issuer/tenant/subject strings use
 * obvious fictional literals so they can never be mistaken for production
 * data. Keep them deterministic so tests stay stable.
 */

import type { Tables, TablesInsert } from '@/types/database.generated'

export const FICTIONAL_ISSUER = 'https://fictional-issuer.example.local'
export const FICTIONAL_WECHAT_APPID = 'wx_fictional_appid_0001'

/**
 * Internal business users (`app_users`). The id is the ONLY key business tables
 * should reference; external subjects live in `user_identities`.
 */
export const appUserFixtures: Tables<'app_users'>[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'active',
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
    disabled_at: null,
    merged_into_user_id: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    status: 'active',
    created_at: '2026-01-02T00:00:00+00:00',
    updated_at: '2026-01-02T00:00:00+00:00',
    disabled_at: null,
    merged_into_user_id: null,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    status: 'invited',
    created_at: '2026-01-03T00:00:00+00:00',
    updated_at: '2026-01-03T00:00:00+00:00',
    disabled_at: null,
    merged_into_user_id: null,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    status: 'suspended',
    created_at: '2026-01-04T00:00:00+00:00',
    updated_at: '2026-01-04T00:00:00+00:00',
    disabled_at: '2026-02-01T00:00:00+00:00',
    merged_into_user_id: null,
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    status: 'merged',
    created_at: '2026-01-05T00:00:00+00:00',
    updated_at: '2026-01-05T00:00:00+00:00',
    disabled_at: '2026-02-02T00:00:00+00:00',
    merged_into_user_id: '11111111-1111-1111-1111-111111111111',
  },
]

/**
 * Insert-shaped rows for `app_users` (id may be client-supplied only inside a
 * trusted migration/test; business code must let the DB generate it).
 */
export const appUserInsertFixtures: TablesInsert<'app_users'>[] = [
  {
    id: '66666666-6666-6666-6666-666666666666',
    status: 'active',
  },
]

/** Public profiles, one-to-one with an active internal user. */
export const profileFixtures: Tables<'profiles'>[] = [
  {
    user_id: '11111111-1111-1111-1111-111111111111',
    display_name: 'Fictional User A',
    organization_name: 'Fictional Org',
    title: 'Fictional Title',
    avatar_url: null,
    contact_info: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  },
  {
    user_id: '22222222-2222-2222-2222-222222222222',
    display_name: 'Fictional User B',
    organization_name: null,
    title: null,
    avatar_url: null,
    contact_info: null,
    created_at: '2026-01-02T00:00:00+00:00',
    updated_at: '2026-01-02T00:00:00+00:00',
  },
]

/**
 * External identities bound to internal users. Subjects are fictional. A revoked
 * identity must retain its row (never rebound) — see `rev_subject` below.
 */
export const userIdentityFixtures: Tables<'user_identities'>[] = [
  {
    id: 'a1111111-1111-1111-1111-111111111111',
    user_id: '11111111-1111-1111-1111-111111111111',
    provider: 'supabase_auth',
    provider_tenant: FICTIONAL_ISSUER,
    provider_subject: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    verified_at: '2026-01-01T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  },
  {
    id: 'a2222222-2222-2222-2222-222222222222',
    user_id: '11111111-1111-1111-1111-111111111111',
    provider: 'wechat_miniprogram',
    provider_tenant: FICTIONAL_WECHAT_APPID,
    provider_subject: 'wx_openid_user_a',
    verified_at: '2026-01-01T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  },
  {
    id: 'b1111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    provider: 'supabase_auth',
    provider_tenant: FICTIONAL_ISSUER,
    provider_subject: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    verified_at: '2026-01-02T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-02T00:00:00+00:00',
    updated_at: '2026-01-02T00:00:00+00:00',
  },
  {
    id: 'c1111111-1111-1111-1111-111111111111',
    user_id: '33333333-3333-3333-3333-333333333333',
    provider: 'supabase_auth',
    provider_tenant: FICTIONAL_ISSUER,
    provider_subject: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    verified_at: '2026-01-03T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-03T00:00:00+00:00',
    updated_at: '2026-01-03T00:00:00+00:00',
  },
  {
    id: 'd1111111-1111-1111-1111-111111111111',
    user_id: '11111111-1111-1111-1111-111111111111',
    provider: 'supabase_auth',
    provider_tenant: 'rev_tenant',
    provider_subject: 'rev_subject',
    verified_at: '2026-01-01T00:00:00+00:00',
    last_used_at: null,
    revoked_at: '2026-01-10T00:00:00+00:00',
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-10T00:00:00+00:00',
  },
  // Provider isolation pair: the SAME (tenant, subject) is bound to two
  // different users under two different providers. Provider is part of the
  // uniqueness key and of resolution — these rows must never collapse.
  {
    id: 'e1111111-1111-1111-1111-111111111111',
    user_id: '11111111-1111-1111-1111-111111111111',
    provider: 'supabase_auth',
    provider_tenant: 'iso_tenant',
    provider_subject: 'iso_subject',
    verified_at: '2026-01-01T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  },
  {
    id: 'f1111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    provider: 'wechat_miniprogram',
    provider_tenant: 'iso_tenant',
    provider_subject: 'iso_subject',
    verified_at: '2026-01-02T00:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-02T00:00:00+00:00',
    updated_at: '2026-01-02T00:00:00+00:00',
  },
]

/**
 * One-time binding challenges. Only `challenge_hash` (a server-side SHA-256
 * hex digest), `provider`/`provider_tenant` and the referenced users are stored;
 * the raw code/token is never persisted.
 */
export const identityBindingChallengeInsertFixtures: TablesInsert<'identity_binding_challenges'>[] =
  [
    {
      target_user_id: '11111111-1111-1111-1111-111111111111',
      provider: 'supabase_auth',
      provider_tenant: FICTIONAL_ISSUER,
      challenge_hash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      expires_at: '2099-01-01T00:00:00+00:00',
      created_by: '11111111-1111-1111-1111-111111111111',
    },
  ]

export const VALID_APP_USER_STATUSES = [
  'invited',
  'active',
  'suspended',
  'merged',
] as const

export const VALID_IDENTITY_PROVIDERS = [
  'supabase_auth',
  'wechat_miniprogram',
  'enterprise_wechat',
] as const
