import { describe, expect, it } from 'vitest'
import {
  FICTIONAL_ISSUER,
  FICTIONAL_WECHAT_APPID,
  VALID_APP_USER_STATUSES,
  VALID_IDENTITY_PROVIDERS,
  appUserFixtures,
  identityBindingChallengeInsertFixtures,
  profileFixtures,
  userIdentityFixtures,
} from '@/features/identity/fixtures'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every provider_tenant used by the fixtures must be an obvious fictional
// literal — no real issuer domains or WeChat AppIDs.
const FICTIONAL_TENANTS = new Set([
  FICTIONAL_ISSUER,
  FICTIONAL_WECHAT_APPID,
  'rev_tenant',
  'iso_tenant',
])

const appUserIds = new Set(appUserFixtures.map((u) => u.id))

function expectReferencesKnownUser(id: string, label: string) {
  expect(
    appUserIds.has(id),
    `${label} ${id} must reference a known app_users.id`,
  ).toBe(true)
}

describe('统一身份模型测试夹具', () => {
  describe('app_users 夹具', () => {
    it('所有状态都是受控枚举值', () => {
      for (const user of appUserFixtures) {
        expect(VALID_APP_USER_STATUSES).toContain(user.status)
      }
    })

    it('id 都是合法的 UUID', () => {
      for (const user of appUserFixtures) {
        expect(user.id).toMatch(UUID_RE)
      }
    })

    it('disabled_at 与状态保持一致', () => {
      for (const user of appUserFixtures) {
        const expectsDisabled =
          user.status === 'suspended' || user.status === 'merged'
        if (expectsDisabled) {
          expect(user.disabled_at).not.toBeNull()
        } else {
          expect(user.disabled_at).toBeNull()
        }
      }
    })

    it('merged 状态必须指向被合并用户，其他状态不能指向', () => {
      for (const user of appUserFixtures) {
        if (user.status === 'merged') {
          expect(user.merged_into_user_id).not.toBeNull()
        } else {
          expect(user.merged_into_user_id).toBeNull()
        }
      }
    })
  })

  describe('profiles 夹具', () => {
    it('display_name 非空且长度受控', () => {
      for (const profile of profileFixtures) {
        const trimmed = profile.display_name.trim()
        expect(trimmed.length).toBeGreaterThan(0)
        expect(trimmed.length).toBeLessThanOrEqual(120)
      }
    })

    it('user_id 必须引用已知的 app_users.id', () => {
      for (const profile of profileFixtures) {
        expectReferencesKnownUser(profile.user_id, 'profile.user_id')
      }
    })
  })

  describe('user_identities 夹具', () => {
    it('provider 是受控枚举值', () => {
      for (const identity of userIdentityFixtures) {
        expect(VALID_IDENTITY_PROVIDERS).toContain(identity.provider)
      }
    })

    it('provider_tenant 与 provider_subject 非空且非空白', () => {
      for (const identity of userIdentityFixtures) {
        expect(identity.provider_tenant.trim().length).toBeGreaterThan(0)
        expect(identity.provider_subject.trim().length).toBeGreaterThan(0)
      }
    })

    it('user_id 必须引用已知的 app_users.id', () => {
      for (const identity of userIdentityFixtures) {
        expectReferencesKnownUser(identity.user_id, 'user_identity.user_id')
      }
    })

    it('revoked_at 非空时满足时间一致且仅撤销行有值', () => {
      const revokedRows = userIdentityFixtures.filter(
        (identity) => identity.revoked_at !== null,
      )
      expect(revokedRows.length).toBe(1)
      for (const identity of revokedRows) {
        expect(identity.revoked_at).not.toBeNull()
        expect(
          new Date(identity.revoked_at as string).getTime(),
        ).toBeGreaterThanOrEqual(new Date(identity.created_at).getTime())
      }
    })

    it('全部身份（含已撤销）在 (provider, tenant, subject) 上唯一', () => {
      // Mirrors the non-partial unique constraint: revoked rows still occupy
      // the key, so a revoked identity can never be rebound to another user.
      const seen = new Set<string>()
      for (const identity of userIdentityFixtures) {
        const key = `${identity.provider}|${identity.provider_tenant}|${identity.provider_subject}`
        expect(seen.has(key), `duplicate identity key ${key}`).toBe(false)
        seen.add(key)
      }
    })

    it('跨 provider 的隔离夹具共享 (tenant, subject) 但归属不同用户', () => {
      const isoRows = userIdentityFixtures.filter(
        (identity) =>
          identity.provider_tenant === 'iso_tenant' &&
          identity.provider_subject === 'iso_subject',
      )
      expect(isoRows.length).toBe(2)
      const providers = new Set(isoRows.map((row) => row.provider))
      const users = new Set(isoRows.map((row) => row.user_id))
      expect(providers.size).toBe(2)
      expect(users.size).toBe(2)
      expect(providers.has('supabase_auth')).toBe(true)
      expect(providers.has('wechat_miniprogram')).toBe(true)
    })
  })

  describe('identity_binding_challenges 夹具', () => {
    it('challenge_hash 是 64 位小写十六进制摘要', () => {
      // Must match the database CHECK exactly: ^[0-9a-f]{64}$ (lowercase only).
      for (const challenge of identityBindingChallengeInsertFixtures) {
        expect(challenge.challenge_hash).toMatch(/^[0-9a-f]{64}$/)
      }
    })

    it('expires_at 在未来', () => {
      for (const challenge of identityBindingChallengeInsertFixtures) {
        expect(new Date(challenge.expires_at).getTime()).toBeGreaterThan(
          Date.now(),
        )
      }
    })

    it('target_user_id 与 created_by 必须引用已知的 app_users.id', () => {
      for (const challenge of identityBindingChallengeInsertFixtures) {
        expectReferencesKnownUser(
          challenge.target_user_id,
          'challenge.target_user_id',
        )
        expectReferencesKnownUser(challenge.created_by, 'challenge.created_by')
      }
    })
  })

  describe('不含真实数据', () => {
    it('所有 provider_tenant 都是已知虚构值', () => {
      for (const identity of userIdentityFixtures) {
        expect(
          FICTIONAL_TENANTS.has(identity.provider_tenant),
          `provider_tenant ${identity.provider_tenant} must be fictional`,
        ).toBe(true)
      }
    })

    it('display_name 不含邮箱或手机号形态', () => {
      const leaky = /@|\d{6,}/u
      for (const profile of profileFixtures) {
        expect(leaky.test(profile.display_name)).toBe(false)
      }
    })
  })
})
