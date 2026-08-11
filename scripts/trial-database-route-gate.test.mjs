import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeTrialPoolerUrl,
  forbiddenAmbientPgSelectors,
  runTrialDatabaseRouteCheck,
  safeTrialDatabaseRouteError,
  stableLinkedPoolerUrlRelativePath,
  validateTrialDatabaseRoute,
} from './trial-database-route-gate.mjs'
import { stableLinkedProjectRefRelativePath } from './trial-deployment-gate.mjs'

const trialProjectRef = 'abcdefghijklmnopqrst'
const otherProjectRef = 'zyxwvutsrqponmlkjihg'
const poolerHost = 'fixture-do-not-use.pooler.supabase.com'
const otherPoolerHost = 'other-fixture.pooler.supabase.com'
const linkedPoolerUrl = `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres`
const operatorPoolerUrl = `${linkedPoolerUrl}?sslmode=require`
const trialArguments = [
  '--target',
  'trial',
  '--confirm',
  'TRIAL',
  '--project-ref',
  trialProjectRef,
]

function validEnvironment(overrides = {}) {
  return {
    SUPABASE_PROFILE: 'supabase',
    SUPABASE_TRIAL_DB_URL: operatorPoolerUrl,
    PGPASSWORD: 'fictional-password-canary',
    ...overrides,
  }
}

function writeStableState(
  repositoryRoot,
  {
    projectRef = trialProjectRef,
    poolerUrl = linkedPoolerUrl,
    poolerAsDirectory = false,
  } = {},
) {
  const stateDirectory = join(
    repositoryRoot,
    ...stableLinkedProjectRefRelativePath.slice(0, -1),
  )
  mkdirSync(stateDirectory, { recursive: true })
  writeFileSync(
    join(stateDirectory, stableLinkedProjectRefRelativePath.at(-1)),
    projectRef + '\n',
    'utf8',
  )
  const poolerPath = join(repositoryRoot, ...stableLinkedPoolerUrlRelativePath)
  if (poolerAsDirectory) {
    mkdirSync(poolerPath, { recursive: true })
  } else {
    writeFileSync(poolerPath, poolerUrl + '\n', 'utf8')
  }
}

function withRepository(options, callback) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-route-gate-'))
  if (options !== null) writeStableState(repositoryRoot, options)
  try {
    return callback(repositoryRoot)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
}

function validate(overrides = {}) {
  return validateTrialDatabaseRoute({
    projectRef: trialProjectRef,
    linkedPoolerUrl,
    environment: validEnvironment(),
    ...overrides,
  })
}

function sanitizedSpawnEnvironment(overrides = {}) {
  const environment = { ...process.env }
  for (const name of [
    ...forbiddenAmbientPgSelectors,
    'PGPASSWORD',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_PROJECT_ID',
    'SUPABASE_PROFILE',
    'SUPABASE_TRIAL_DB_URL',
    'SUPABASE_WORKDIR',
  ]) {
    delete environment[name]
  }
  return { ...environment, ...validEnvironment(), ...overrides }
}

describe('trial database route gate', () => {
  it('accepts the exact passwordless Session Pooler route', () => {
    expect(validate()).toEqual({
      target: 'trial',
      linked: true,
      route: 'session-pooler',
      port: 5432,
      tls: 'require',
      database: 'postgres',
      message:
        'Trial database route gate passed (target=trial, linked=yes, route=session-pooler, port=5432, tls=require, db-url=withheld).',
    })
  })

  it('normalizes postgres and postgresql to one protocol class', () => {
    const canonical = canonicalizeTrialPoolerUrl(
      `postgres://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=require`,
      { projectRef: trialProjectRef, operator: true },
    )
    expect(canonical).toEqual({
      protocol: 'postgresql',
      username: `postgres.${trialProjectRef}`,
      hostname: poolerHost,
      port: 5432,
      database: 'postgres',
    })
  })

  it('uses the stable CLI pooler metadata path', () => {
    expect(stableLinkedPoolerUrlRelativePath).toEqual([
      'supabase',
      '.temp',
      'pooler-url',
    ])
  })

  it('runs only after the existing linked Trial identity gate passes', () => {
    withRepository({}, (repositoryRoot) => {
      expect(
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toMatchObject({ target: 'trial', linked: true })
    })
  })

  it.each([
    [
      [
        '--target',
        'production',
        '--confirm',
        'TRIAL',
        '--project-ref',
        trialProjectRef,
      ],
      {},
    ],
    [
      [
        '--target',
        'staging',
        '--confirm',
        'TRIAL',
        '--project-ref',
        trialProjectRef,
      ],
      {},
    ],
    [
      [
        '--target',
        'trial',
        '--confirm',
        'trial',
        '--project-ref',
        trialProjectRef,
      ],
      {},
    ],
    [
      [
        '--target',
        'trial',
        '--confirm',
        'TRIAL',
        '--project-ref',
        'invalid-ref',
      ],
      {},
    ],
    [trialArguments, { SUPABASE_PROJECT_ID: otherProjectRef }],
    [trialArguments, { SUPABASE_WORKDIR: 'fictional-workdir' }],
    [trialArguments, { SUPABASE_PROFILE: undefined }],
    [trialArguments, { SUPABASE_PROFILE: 'fictional-profile' }],
  ])('fails closed for an invalid identity execution context', (args, env) => {
    withRepository({}, (repositoryRoot) => {
      expect(() =>
        runTrialDatabaseRouteCheck(args, repositoryRoot, validEnvironment(env)),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it('fails closed when linked project state is missing', () => {
    withRepository(null, (repositoryRoot) => {
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it('fails closed when linked project state does not match', () => {
    withRepository({ projectRef: otherProjectRef }, (repositoryRoot) => {
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it.each([
    [],
    [...trialArguments, '--allow-unlinked'],
    [...trialArguments, '--unknown'],
    [...trialArguments, '--target', 'trial'],
  ])('rejects missing, allow-unlinked, unknown, or duplicate flags', (args) => {
    withRepository({}, (repositoryRoot) => {
      expect(() =>
        runTrialDatabaseRouteCheck(args, repositoryRoot, validEnvironment()),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it.each([
    ['', 'empty'],
    ['not-a-url', 'malformed'],
    [
      `https://postgres.${trialProjectRef}@${poolerHost}:5432/postgres`,
      'wrong protocol',
    ],
    [
      `postgresql://postgres.${otherProjectRef}@${poolerHost}:5432/postgres`,
      'wrong project ref',
    ],
    [
      `postgresql://postgres@${poolerHost}:5432/postgres`,
      'wrong username shape',
    ],
    [
      `postgresql://other.${trialProjectRef}@${poolerHost}:5432/postgres`,
      'wrong username',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@db.${trialProjectRef}.supabase.co:5432/postgres`,
      'direct host',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@fixture-pooler.example.invalid:5432/postgres`,
      'wrong domain',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5433/postgres`,
      'wrong port',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:6543/postgres`,
      'transaction port',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/template1`,
      'wrong database',
    ],
    [
      `postgresql://postgres.${trialProjectRef}:fictional-password@${poolerHost}:5432/postgres`,
      'password',
    ],
    [
      `postgresql://postgres.${trialProjectRef}:@${poolerHost}:5432/postgres`,
      'empty password',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?options=fictional`,
      'query override',
    ],
  ])('rejects linked pooler metadata with %s (%s)', (poolerUrl) => {
    expect(() => validate({ linkedPoolerUrl: poolerUrl })).toThrow(
      safeTrialDatabaseRouteError,
    )
  })

  it('fails closed when pooler-url is missing', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-route-gate-'))
    const stateDirectory = join(
      repositoryRoot,
      ...stableLinkedProjectRefRelativePath.slice(0, -1),
    )
    mkdirSync(stateDirectory, { recursive: true })
    writeFileSync(
      join(stateDirectory, stableLinkedProjectRefRelativePath.at(-1)),
      trialProjectRef,
      'utf8',
    )
    try {
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when pooler-url is unreadable', () => {
    withRepository({ poolerAsDirectory: true }, (repositoryRoot) => {
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it.each([
    [undefined, 'missing'],
    ['', 'empty'],
    ['fictional-db-url', 'malformed'],
    [
      `postgresql://postgres.${trialProjectRef}@db.${trialProjectRef}.supabase.co:5432/postgres?sslmode=require`,
      'direct',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:6543/postgres?sslmode=require`,
      'transaction pooler',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${otherPoolerHost}:5432/postgres?sslmode=require`,
      'different pooler host',
    ],
    [
      `postgresql://postgres.${otherProjectRef}@${poolerHost}:5432/postgres?sslmode=require`,
      'different tenant',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/template1?sslmode=require`,
      'wrong database',
    ],
    [
      `https://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=require`,
      'HTTP protocol',
    ],
    [
      `postgresql://postgres.${trialProjectRef}:fictional-password@${poolerHost}:5432/postgres?sslmode=require`,
      'password',
    ],
    [
      `postgresql://postgres.${trialProjectRef}:@${poolerHost}:5432/postgres?sslmode=require`,
      'empty password',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres`,
      'missing sslmode',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=prefer`,
      'prefer TLS',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=disable`,
      'disabled TLS',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=require&options=fictional`,
      'extra query',
    ],
    [
      `postgresql://postgres.${trialProjectRef}@${poolerHost}:5432/postgres?sslmode=require#fictional`,
      'fragment',
    ],
  ])('rejects an operator URL with %s (%s)', (operatorDatabaseUrl) => {
    expect(() =>
      validate({
        environment: validEnvironment({
          SUPABASE_TRIAL_DB_URL: operatorDatabaseUrl,
        }),
      }),
    ).toThrow(safeTrialDatabaseRouteError)
  })

  it.each([
    [undefined, false],
    ['', false],
    ['fictional-password-canary', true],
  ])('requires exactly one non-empty PGPASSWORD source', (password, passes) => {
    const operation = () =>
      validate({ environment: validEnvironment({ PGPASSWORD: password }) })
    if (passes) {
      expect(operation()).toMatchObject({ route: 'session-pooler' })
    } else {
      expect(operation).toThrow(safeTrialDatabaseRouteError)
    }
  })

  it.each(forbiddenAmbientPgSelectors)(
    'rejects non-empty ambient selector %s',
    (selector) => {
      expect(() =>
        validate({
          environment: validEnvironment({ [selector]: 'fictional-value' }),
        }),
      ).toThrow(safeTrialDatabaseRouteError)
    },
  )

  it.each(forbiddenAmbientPgSelectors)(
    'allows empty ambient selector %s',
    (selector) => {
      expect(
        validate({ environment: validEnvironment({ [selector]: '' }) }),
      ).toMatchObject({ route: 'session-pooler' })
    },
  )

  it.each(forbiddenAmbientPgSelectors)(
    'allows absent ambient selector %s',
    (selector) => {
      expect(
        validate({
          environment: validEnvironment({ [selector]: undefined }),
        }),
      ).toMatchObject({ route: 'session-pooler' })
    },
  )

  it('accepts the audited v2.110.0 PG selector set only', () => {
    expect(forbiddenAmbientPgSelectors).toEqual([
      'PGAPPNAME',
      'PGCONNECT_TIMEOUT',
      'PGDATABASE',
      'PGHOST',
      'PGPASSFILE',
      'PGPORT',
      'PGSERVICE',
      'PGSERVICEFILE',
      'PGSSLCERT',
      'PGSSLKEY',
      'PGSSLMODE',
      'PGSSLPASSWORD',
      'PGSSLROOTCERT',
      'PGUSER',
    ])
  })

  it('rejects linked password semantics from SUPABASE_DB_PASSWORD', () => {
    expect(() =>
      validate({
        environment: validEnvironment({
          SUPABASE_DB_PASSWORD: 'fictional-linked-password',
        }),
      }),
    ).toThrow(safeTrialDatabaseRouteError)
    expect(
      validate({
        environment: validEnvironment({ SUPABASE_DB_PASSWORD: '' }),
      }),
    ).toMatchObject({ route: 'session-pooler' })
  })

  it('withholds all route and credential inputs from success and failure', () => {
    const success = validate()
    const successText = JSON.stringify(success)
    for (const value of [
      trialProjectRef,
      poolerHost,
      operatorPoolerUrl,
      'fictional-password-canary',
    ]) {
      expect(successText).not.toContain(value)
    }

    let failure = ''
    try {
      validate({
        environment: validEnvironment({
          SUPABASE_TRIAL_DB_URL: 'fictional-db-url',
          PGPASSWORD: 'fictional-password',
        }),
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toBe(safeTrialDatabaseRouteError)
    for (const canary of [
      'fictional-project-ref',
      'fictional-pooler-host',
      'fictional-password',
      'fictional-db-url',
      'fictional-profile',
      'fictional-workdir',
    ]) {
      expect(failure).not.toContain(canary)
    }
  })

  it('keeps CLI stderr redacted for canary target and environment values', () => {
    withRepository({}, (repositoryRoot) => {
      const result = spawnSync(
        process.execPath,
        [
          join(process.cwd(), 'scripts', 'trial-database-route-gate.mjs'),
          '--target',
          'trial',
          '--confirm',
          'TRIAL',
          '--project-ref',
          'fictional-project-ref',
        ],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: sanitizedSpawnEnvironment({
            SUPABASE_PROFILE: 'fictional-profile',
            SUPABASE_WORKDIR: 'fictional-workdir',
            SUPABASE_TRIAL_DB_URL: 'fictional-db-url',
            PGPASSWORD: 'fictional-password',
          }),
        },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr.trim()).toBe(safeTrialDatabaseRouteError)
      for (const canary of [
        'fictional-project-ref',
        'fictional-pooler-host',
        'fictional-password',
        'fictional-db-url',
        'fictional-profile',
        'fictional-workdir',
      ]) {
        expect(result.stderr).not.toContain(canary)
      }
    })
  })

  it('prints only the withheld success summary from the CLI', () => {
    withRepository({}, (repositoryRoot) => {
      const result = spawnSync(
        process.execPath,
        [
          join(process.cwd(), 'scripts', 'trial-database-route-gate.mjs'),
          ...trialArguments,
        ],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: sanitizedSpawnEnvironment(),
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim()).toBe(
        'Trial database route gate passed (target=trial, linked=yes, route=session-pooler, port=5432, tls=require, db-url=withheld).',
      )
      expect(result.stdout).not.toContain(trialProjectRef)
      expect(result.stdout).not.toContain(poolerHost)
      expect(result.stdout).not.toContain(operatorPoolerUrl)
    })
  })
})
