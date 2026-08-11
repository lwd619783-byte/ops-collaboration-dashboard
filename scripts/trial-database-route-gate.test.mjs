import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeTrialPoolerUrl,
  containsForbiddenPersistentDatabaseEnvironmentAssignment,
  forbiddenAmbientPgSelectors,
  forbiddenMigrationBehaviorEnvironmentKeys,
  forbiddenPersistentDatabaseEnvironmentKeys,
  runTrialDatabaseRouteCheck,
  safeTrialDatabaseRouteError,
  stableDevelopmentProjectEnvRelativePaths,
  stableLinkedPoolerUrlRelativePath,
  validateNoMigrationBehaviorEnvironmentOverrides,
  validateNoPersistentDatabaseRouteSelectors,
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

function writeProjectEnvironmentFile(repositoryRoot, relativePath, contents) {
  const filePath = join(repositoryRoot, ...relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents, 'utf8')
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
    ...forbiddenMigrationBehaviorEnvironmentKeys,
    'PGPASSWORD',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_ENV',
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

  it('pins the exact stable development project environment paths', () => {
    expect(stableDevelopmentProjectEnvRelativePaths).toEqual([
      ['supabase', '.env.development.local'],
      ['supabase', '.env.local'],
      ['supabase', '.env.development'],
      ['supabase', '.env'],
      ['.env.development.local'],
      ['.env.local'],
      ['.env.development'],
      ['.env'],
    ])
  })

  it('pins every database-specific persistent environment key', () => {
    expect(forbiddenPersistentDatabaseEnvironmentKeys).toEqual([
      'SUPABASE_TRIAL_DB_URL',
      'SUPABASE_DB_PASSWORD',
      'PGPASSWORD',
      ...forbiddenMigrationBehaviorEnvironmentKeys,
      ...forbiddenAmbientPgSelectors,
    ])
  })

  it('pins only the audited migration behavior environment keys', () => {
    expect(forbiddenMigrationBehaviorEnvironmentKeys).toEqual([
      'SUPABASE_YES',
      'SUPABASE_DB_MIGRATIONS_ENABLED',
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
    [['.env'], 'PGSERVICE=fixture'],
    [['.env.local'], 'PGSSLROOTCERT=fixture'],
    [['.env.development'], 'PGPASSWORD=fixture'],
    [['.env.development.local'], 'SUPABASE_TRIAL_DB_URL=fixture'],
    [['supabase', '.env'], 'PGSERVICE=fixture'],
    [['supabase', '.env.local'], 'PGSSLROOTCERT=fixture'],
    [['supabase', '.env.development'], 'PGPASSWORD=fixture'],
    [['supabase', '.env.development.local'], 'SUPABASE_TRIAL_DB_URL=fixture'],
  ])('rejects a persistent database selector in %j', (relativePath, line) => {
    withRepository({}, (repositoryRoot) => {
      writeProjectEnvironmentFile(repositoryRoot, relativePath, line + '\n')
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
    [['.env'], 'SUPABASE_YES=true'],
    [['supabase', '.env.local'], 'SUPABASE_YES=true'],
    [['.env.development'], 'SUPABASE_DB_MIGRATIONS_ENABLED=false'],
    [
      ['supabase', '.env.development.local'],
      'SUPABASE_DB_MIGRATIONS_ENABLED=true',
    ],
  ])(
    'rejects a persistent migration behavior override in %j',
    (relativePath, line) => {
      withRepository({}, (repositoryRoot) => {
        writeProjectEnvironmentFile(repositoryRoot, relativePath, line + '\n')
        expect(() =>
          runTrialDatabaseRouteCheck(
            trialArguments,
            repositoryRoot,
            validEnvironment(),
          ),
        ).toThrow(safeTrialDatabaseRouteError)
      })
    },
  )

  it.each(forbiddenMigrationBehaviorEnvironmentKeys)(
    'rejects an empty persistent migration behavior assignment: %s',
    (key) => {
      withRepository({}, (repositoryRoot) => {
        writeProjectEnvironmentFile(repositoryRoot, ['.env'], `${key}=\n`)
        expect(() =>
          validateNoPersistentDatabaseRouteSelectors(
            repositoryRoot,
            validEnvironment(),
          ),
        ).toThrow(safeTrialDatabaseRouteError)
      })
    },
  )

  it.each([
    'PGHOST=fixture',
    'PGHOST = fixture',
    'export PGHOST=fixture',
    'export PGHOST = fixture',
    'PGHOST: fixture',
  ])('rejects persistent dotenv assignment syntax: %s', (line) => {
    withRepository({}, (repositoryRoot) => {
      writeProjectEnvironmentFile(repositoryRoot, ['.env'], line + '\n')
      expect(() =>
        validateNoPersistentDatabaseRouteSelectors(
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it('rejects an empty persistent database assignment', () => {
    withRepository({}, (repositoryRoot) => {
      writeProjectEnvironmentFile(repositoryRoot, ['.env'], 'PGHOST=\n')
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it('treats backtick as an ordinary unquoted value character', () => {
    expect(
      containsForbiddenPersistentDatabaseEnvironmentAssignment(
        'UNRELATED=`ordinary-value\nPGHOST=forbidden\n',
      ),
    ).toBe(true)
  })

  it('rejects a persistent PGHOST after an unquoted backtick value', () => {
    withRepository({}, (repositoryRoot) => {
      writeProjectEnvironmentFile(
        repositoryRoot,
        ['.env'],
        'UNRELATED=`fixture\nPGHOST=forbidden-host\n',
      )
      expect(() =>
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it('rejects and redacts a persistent password after a backtick value', () => {
    withRepository({}, (repositoryRoot) => {
      const canary = 'never-print-this-password'
      writeProjectEnvironmentFile(
        repositoryRoot,
        ['.env'],
        `UNRELATED=\`fixture\nPGPASSWORD=${canary}\n`,
      )

      let failure = ''
      try {
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        )
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      expect(failure).toBe(safeTrialDatabaseRouteError)
      expect(failure).not.toContain(canary)

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
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(safeTrialDatabaseRouteError + '\n')
      expect(result.stdout).not.toContain(canary)
      expect(result.stderr).not.toContain(canary)
    })
  })

  it.each(['"', "'"])(
    'allows an unrelated %s-quoted multiline value and comments',
    (quote) => {
      withRepository({}, (repositoryRoot) => {
        writeProjectEnvironmentFile(
          repositoryRoot,
          ['.env'],
          [
            '# PGHOST=comment-only',
            'VITE_APP_NAME=fixture',
            'UNRELATED = allowed',
            `MULTILINE=${quote}first line`,
            'PGHOST=quoted-value-not-an-assignment',
            `last line${quote}`,
            '',
          ].join('\n'),
        )
        writeProjectEnvironmentFile(
          repositoryRoot,
          ['supabase', '.env.development.local'],
          'VITE_SUPABASE_URL=https://example.invalid\n',
        )
        expect(
          runTrialDatabaseRouteCheck(
            trialArguments,
            repositoryRoot,
            validEnvironment(),
          ),
        ).toMatchObject({ route: 'session-pooler' })
      })
    },
  )

  it('fails closed when a project environment candidate is unreadable', () => {
    withRepository({}, (repositoryRoot) => {
      mkdirSync(join(repositoryRoot, '.env'), { recursive: true })
      expect(() =>
        validateNoPersistentDatabaseRouteSelectors(
          repositoryRoot,
          validEnvironment(),
        ),
      ).toThrow(safeTrialDatabaseRouteError)
    })
  })

  it.each([undefined, '', 'development'])(
    'accepts the stable development environment selection %s',
    (projectEnvironment) => {
      withRepository({}, (repositoryRoot) => {
        expect(
          runTrialDatabaseRouteCheck(
            trialArguments,
            repositoryRoot,
            validEnvironment({ SUPABASE_ENV: projectEnvironment }),
          ),
        ).toMatchObject({ route: 'session-pooler' })
      })
    },
  )

  it.each([
    ['SUPABASE_YES', 'true'],
    ['SUPABASE_YES', 'false'],
    ['SUPABASE_DB_MIGRATIONS_ENABLED', 'true'],
    ['SUPABASE_DB_MIGRATIONS_ENABLED', 'false'],
  ])('rejects shell migration behavior override %s=%s', (key, value) => {
    expect(() =>
      validateNoMigrationBehaviorEnvironmentOverrides({ [key]: value }),
    ).toThrow(safeTrialDatabaseRouteError)
    expect(() =>
      validate({ environment: validEnvironment({ [key]: value }) }),
    ).toThrow(safeTrialDatabaseRouteError)
  })

  it.each(forbiddenMigrationBehaviorEnvironmentKeys)(
    'allows an absent or empty shell migration behavior selector: %s',
    (key) => {
      expect(
        validateNoMigrationBehaviorEnvironmentOverrides({ [key]: '' }),
      ).toBe(true)
      expect(
        validateNoMigrationBehaviorEnvironmentOverrides({
          [key]: undefined,
        }),
      ).toBe(true)
      expect(
        validate({ environment: validEnvironment({ [key]: '' }) }),
      ).toMatchObject({ route: 'session-pooler' })
      expect(
        validate({ environment: validEnvironment({ [key]: undefined }) }),
      ).toMatchObject({ route: 'session-pooler' })
    },
  )

  it.each(['test', 'staging', 'production', 'custom'])(
    'rejects a non-development project environment selection without echo: %s',
    (projectEnvironment) => {
      withRepository({}, (repositoryRoot) => {
        let failure = ''
        try {
          runTrialDatabaseRouteCheck(
            trialArguments,
            repositoryRoot,
            validEnvironment({ SUPABASE_ENV: projectEnvironment }),
          )
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error)
        }
        expect(failure).toBe(safeTrialDatabaseRouteError)
        expect(failure).not.toContain(projectEnvironment)
      })
    },
  )

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

  it('withholds a persistent project password canary from the error', () => {
    withRepository({}, (repositoryRoot) => {
      const canary = 'never-print-this-project-password'
      writeProjectEnvironmentFile(
        repositoryRoot,
        ['.env'],
        `PGPASSWORD=${canary}\n`,
      )
      let failure = ''
      try {
        runTrialDatabaseRouteCheck(
          trialArguments,
          repositoryRoot,
          validEnvironment(),
        )
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      expect(failure).toBe(safeTrialDatabaseRouteError)
      expect(failure).not.toContain(canary)
    })
  })

  it.each(forbiddenMigrationBehaviorEnvironmentKeys)(
    'withholds persistent migration behavior value for %s',
    (key) => {
      withRepository({}, (repositoryRoot) => {
        const canary = 'never-print-this-value'
        writeProjectEnvironmentFile(
          repositoryRoot,
          ['.env'],
          `${key}=${canary}\n`,
        )

        let failure = ''
        try {
          runTrialDatabaseRouteCheck(
            trialArguments,
            repositoryRoot,
            validEnvironment(),
          )
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error)
        }
        expect(failure).toBe(safeTrialDatabaseRouteError)
        expect(failure).not.toContain(canary)

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
        expect(result.status).toBe(1)
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe(safeTrialDatabaseRouteError + '\n')
        expect(result.stdout).not.toContain(canary)
        expect(result.stderr).not.toContain(canary)
      })
    },
  )

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

  it('fails the CLI safely for a persistent project selector', () => {
    withRepository({}, (repositoryRoot) => {
      const canary = 'never-print-this-project-password'
      writeProjectEnvironmentFile(
        repositoryRoot,
        ['supabase', '.env.local'],
        `PGPASSWORD=${canary}\n`,
      )
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
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(safeTrialDatabaseRouteError + '\n')
      expect(result.stderr).not.toContain(canary)
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
