import { describe, expect, it } from 'vitest'
import {
  canonicalIssuerForProjectRef,
  containsForbiddenRecoveryEnvironmentAssignment,
  parseRecoveryRebindArguments,
  projectRefFromCanonicalIssuer,
  recoveryConfirmations,
  validateRecoveryOperatorInputs,
} from './recovery-auth-tenant-rebind.mjs'

const sourceProjectRef = 'a'.repeat(20)
const targetProjectRef = 'b'.repeat(20)
const productionProjectRef = 'c'.repeat(20)
const sourceIssuer = `https://${sourceProjectRef}.supabase.co/auth/v1`
const targetIssuer = `https://${targetProjectRef}.supabase.co/auth/v1`
const linkedPoolerUrl = `postgresql://postgres.${targetProjectRef}@aws-0-example.pooler.supabase.com:5432/postgres`

function environment(overrides = {}) {
  return {
    RECOVERY_TARGET_CLASSIFICATION: recoveryConfirmations.classification,
    RECOVERY_OPERATOR_AUTHORIZATION: recoveryConfirmations.authorization,
    RECOVERY_AUTHENTICATION_EVIDENCE: recoveryConfirmations.authentication,
    RECOVERY_TARGET_PROJECT_REF: targetProjectRef,
    RECOVERY_ACTIVE_TRIAL_PROJECT_REF: sourceProjectRef,
    RECOVERY_PRODUCTION_PROJECT_REF: productionProjectRef,
    RECOVERY_SOURCE_ISSUER: sourceIssuer,
    RECOVERY_TARGET_ISSUER: targetIssuer,
    RECOVERY_AUTH_SUBJECT: '10000000-0000-4000-8000-000000000001',
    RECOVERY_EXPECTED_SYSTEM_IDENTIFIER: '1234567890123456789',
    RECOVERY_EXPECTED_LATEST_MIGRATION: '20260812124927',
    RECOVERY_EXPECTED_MIGRATION_COUNT: '22',
    RECOVERY_DB_URL: `${linkedPoolerUrl}?sslmode=require`,
    PGPASSWORD: 'x',
    SUPABASE_PROFILE: 'supabase',
    ...overrides,
  }
}

function validate(overrides = {}, options = {}) {
  return validateRecoveryOperatorInputs({
    environment: environment(overrides),
    linkedProjectRef: options.linkedProjectRef ?? targetProjectRef,
    linkedPoolerUrl: options.linkedPoolerUrl ?? linkedPoolerUrl,
  })
}

describe('Recovery Auth Tenant Rebind V1 arguments', () => {
  it('accepts PLAN without APPLY inputs', () => {
    expect(
      parseRecoveryRebindArguments([
        '--mode',
        'plan',
        '--confirm',
        recoveryConfirmations.target,
      ]),
    ).toMatchObject({ mode: 'plan' })
  })

  it('accepts APPLY only with a reviewed digest and second confirmation', () => {
    expect(
      parseRecoveryRebindArguments([
        '--mode',
        'apply',
        '--confirm',
        recoveryConfirmations.target,
        '--plan-digest',
        'a'.repeat(64),
        '--confirm-apply',
        recoveryConfirmations.apply,
      ]),
    ).toMatchObject({ mode: 'apply', planDigest: 'a'.repeat(64) })
  })

  it.each([
    ['unknown mode', ['--mode', 'other', '--confirm', 'RECOVERY']],
    ['missing target confirmation', ['--mode', 'plan']],
    [
      'PLAN carrying APPLY inputs',
      [
        '--mode',
        'plan',
        '--confirm',
        'RECOVERY',
        '--plan-digest',
        'a'.repeat(64),
      ],
    ],
    [
      'APPLY missing second confirmation',
      [
        '--mode',
        'apply',
        '--confirm',
        'RECOVERY',
        '--plan-digest',
        'a'.repeat(64),
      ],
    ],
    [
      'APPLY malformed digest',
      [
        '--mode',
        'apply',
        '--confirm',
        'RECOVERY',
        '--plan-digest',
        'not-a-digest',
        '--confirm-apply',
        recoveryConfirmations.apply,
      ],
    ],
  ])('rejects %s', (_name, argv) => {
    expect(() => parseRecoveryRebindArguments(argv)).toThrow()
  })
})

describe('Recovery target and route gate', () => {
  it('accepts an isolated Recovery target with all independent evidence', () => {
    const result = validate()
    expect(result).toMatchObject({
      sourceIssuer,
      targetIssuer,
      targetProjectRef,
      expectedMigrationCount: 22,
    })
    expect(result.route).toMatchObject({ port: 5432, database: 'postgres' })
  })

  it('accepts an explicit current inventory with no Production project', () => {
    expect(
      validate({
        RECOVERY_PRODUCTION_PROJECT_REF: recoveryConfirmations.noProduction,
      }).targetProjectRef,
    ).toBe(targetProjectRef)
  })

  it('derives only exact canonical hosted issuers', () => {
    expect(canonicalIssuerForProjectRef(targetProjectRef)).toBe(targetIssuer)
    expect(projectRefFromCanonicalIssuer(targetIssuer)).toBe(targetProjectRef)
    expect(() => projectRefFromCanonicalIssuer(`${targetIssuer}/`)).toThrow()
    expect(() =>
      projectRefFromCanonicalIssuer(targetIssuer.toUpperCase()),
    ).toThrow()
  })

  it.each([
    [
      'missing Recovery classification',
      { RECOVERY_TARGET_CLASSIFICATION: undefined },
    ],
    [
      'missing operator authorization',
      { RECOVERY_OPERATOR_AUTHORIZATION: undefined },
    ],
    [
      'missing successful Recovery authentication evidence',
      { RECOVERY_AUTHENTICATION_EVIDENCE: undefined },
    ],
    ['blank target issuer', { RECOVERY_TARGET_ISSUER: '' }],
    [
      'non-canonical target issuer',
      { RECOVERY_TARGET_ISSUER: `${targetIssuer}/` },
    ],
    [
      'source issuer not matching active Trial inventory',
      { RECOVERY_ACTIVE_TRIAL_PROJECT_REF: productionProjectRef },
    ],
    [
      'source and target issuer are equal',
      {
        RECOVERY_SOURCE_ISSUER: targetIssuer,
        RECOVERY_ACTIVE_TRIAL_PROJECT_REF: targetProjectRef,
      },
    ],
    [
      'Production target',
      {
        RECOVERY_TARGET_PROJECT_REF: productionProjectRef,
        RECOVERY_TARGET_ISSUER: `https://${productionProjectRef}.supabase.co/auth/v1`,
      },
    ],
    ['invalid Auth subject UUID', { RECOVERY_AUTH_SUBJECT: 'not-a-uuid' }],
    [
      'missing database system identifier evidence',
      { RECOVERY_EXPECTED_SYSTEM_IDENTIFIER: undefined },
    ],
    [
      'invalid expected migration version',
      { RECOVERY_EXPECTED_LATEST_MIGRATION: 'latest' },
    ],
    [
      'invalid expected migration count',
      { RECOVERY_EXPECTED_MIGRATION_COUNT: '0' },
    ],
    ['unfixed Supabase profile', { SUPABASE_PROFILE: undefined }],
    ['ambient Supabase workdir', { SUPABASE_WORKDIR: 'elsewhere' }],
    [
      'ambient active Trial database route',
      { SUPABASE_TRIAL_DB_URL: 'postgresql://withheld.invalid/postgres' },
    ],
    [
      'ambient active Trial project context',
      { SUPABASE_TRIAL_PROJECT_REF: sourceProjectRef },
    ],
    ['automatic CLI confirmation', { SUPABASE_YES: 'true' }],
    ['alternate database host', { PGHOST: 'other.example.invalid' }],
    ['missing unique password source', { PGPASSWORD: undefined }],
    [
      'embedded database password',
      {
        RECOVERY_DB_URL: [
          `postgresql://postgres.${targetProjectRef}:`,
          'synthetic-credential',
          '@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=require',
        ].join(''),
      },
    ],
    [
      'transaction pooler port',
      {
        RECOVERY_DB_URL: `postgresql://postgres.${targetProjectRef}@aws-0-example.pooler.supabase.com:6543/postgres?sslmode=require`,
      },
    ],
  ])('fails closed for %s', (_name, overrides) => {
    expect(() => validate(overrides)).toThrow()
  })

  it('rejects a linked project that differs from the confirmed Recovery ref', () => {
    expect(() =>
      validate({}, { linkedProjectRef: productionProjectRef }),
    ).toThrow()
  })

  it('rejects a route that differs from linked Session Pooler metadata', () => {
    expect(() =>
      validate(
        {},
        {
          linkedPoolerUrl: `postgresql://postgres.${targetProjectRef}@aws-1-other.pooler.supabase.com:5432/postgres`,
        },
      ),
    ).toThrow()
  })
})

describe('Recovery environment persistence guard', () => {
  it.each([
    'RECOVERY_DB_URL=value',
    '  export RECOVERY_AUTH_SUBJECT = value',
    'PGPASSWORD=',
    'SUPABASE_PROFILE: supabase',
    'PGHOST=value',
    'SUPABASE_YES=true',
  ])('rejects a persistent assignment: %s', (contents) => {
    expect(containsForbiddenRecoveryEnvironmentAssignment(contents)).toBe(true)
  })

  it('does not reject unrelated browser-safe project configuration', () => {
    expect(
      containsForbiddenRecoveryEnvironmentAssignment(
        'VITE_SUPABASE_URL=https://example.invalid\nUNRELATED=value\n',
      ),
    ).toBe(false)
  })

  it('does not interpret text inside a continued quoted value as an assignment', () => {
    expect(
      containsForbiddenRecoveryEnvironmentAssignment(
        'UNRELATED="line one\nRECOVERY_DB_URL=not-an-assignment\nline three"\n',
      ),
    ).toBe(false)
  })
})
