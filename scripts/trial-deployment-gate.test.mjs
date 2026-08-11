import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseTrialTargetArguments,
  runTrialTargetCheck,
  safeTrialTargetError,
  stableLinkedProjectRefRelativePath,
  stableSupabaseCliVersion,
  validateTrialTarget,
} from './trial-deployment-gate.mjs'

const trialProjectRef = 'abcdefghijklmnopqrst'
const otherProjectRef = 'zyxwvutsrqponmlkjihg'
const trialArguments = [
  '--target',
  'trial',
  '--confirm',
  'TRIAL',
  '--project-ref',
  trialProjectRef,
]

function writeStableLinkedState(repositoryRoot, projectRef = trialProjectRef) {
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
}

function writeNextChannelState(repositoryRoot, projectRef = otherProjectRef) {
  const stateDirectory = join(repositoryRoot, '.supabase')
  mkdirSync(stateDirectory, { recursive: true })
  writeFileSync(
    join(stateDirectory, 'project.json'),
    JSON.stringify({
      project: {
        ref: projectRef,
        name: 'Fictional next-channel project',
        organization_id: 'fictional-organization-id',
        organization_slug: 'fictional-organization',
      },
      active_branch: {
        ref: projectRef,
        name: 'main',
        is_default: true,
      },
      fetchedAt: '2000-01-01T00:00:00.000Z',
      versions: {},
    }),
    'utf8',
  )
}

function validInput(overrides = {}) {
  return {
    target: 'trial',
    confirmation: 'TRIAL',
    projectRef: trialProjectRef,
    linkedProjectRef: trialProjectRef,
    supabaseProfile: 'supabase',
    ...overrides,
  }
}

function trialEnvironment(overrides = {}) {
  return {
    SUPABASE_PROFILE: 'supabase',
    ...overrides,
  }
}

describe('trial deployment target gate', () => {
  it('accepts an explicit trial target only when the linked ref matches', () => {
    expect(validateTrialTarget(validInput())).toEqual({
      target: 'trial',
      linked: true,
      message:
        'Trial target gate passed (target=trial, linked=yes, project-ref=withheld).',
    })
  })

  it('permits the pre-link check only with the explicit allow-unlinked flag', () => {
    expect(
      validateTrialTarget(
        validInput({ linkedProjectRef: undefined, allowUnlinked: true }),
      ),
    ).toMatchObject({ target: 'trial', linked: false })
  })

  it('pins the stable Supabase CLI contract under test', () => {
    expect(stableSupabaseCliVersion).toBe('2.110.0')
    expect(stableLinkedProjectRefRelativePath).toEqual([
      'supabase',
      '.temp',
      'project-ref',
    ])
  })

  it.each([
    { target: undefined },
    { confirmation: undefined },
    { projectRef: undefined },
    { projectRef: 'short-ref' },
    { projectRef: 'abcdefghij1234567890' },
    { linkedProjectRef: undefined },
    { linkedProjectRef: otherProjectRef },
  ])('fails closed for missing, partial, or mismatched input: %o', (value) => {
    expect(() => validateTrialTarget(validInput(value))).toThrow(
      safeTrialTargetError,
    )
  })

  it.each(['production', 'staging', 'local', ''])(
    'rejects target %j',
    (target) => {
      expect(() => validateTrialTarget(validInput({ target }))).toThrow(
        safeTrialTargetError,
      )
    },
  )

  it('requires a separate case-sensitive TRIAL confirmation', () => {
    expect(() =>
      validateTrialTarget(validInput({ confirmation: 'trial' })),
    ).toThrow(safeTrialTargetError)
  })

  it('never includes the supplied project refs in success or failure text', () => {
    const success = validateTrialTarget(validInput())
    expect(success.message).not.toContain(trialProjectRef)

    let failure = ''
    try {
      validateTrialTarget(validInput({ linkedProjectRef: otherProjectRef }))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toBe(safeTrialTargetError)
    expect(failure).not.toContain(trialProjectRef)
    expect(failure).not.toContain(otherProjectRef)
  })

  it('requires any SUPABASE_PROJECT_ID override to match the confirmed Trial ref', () => {
    expect(
      validateTrialTarget(validInput({ supabaseProjectId: trialProjectRef })),
    ).toMatchObject({ target: 'trial', linked: true })
    expect(() =>
      validateTrialTarget(validInput({ supabaseProjectId: otherProjectRef })),
    ).toThrow(safeTrialTargetError)
    expect(() =>
      validateTrialTarget(validInput({ supabaseProjectId: 'invalid-ref' })),
    ).toThrow(safeTrialTargetError)
  })

  it.each([undefined, ''])(
    'allows a clean SUPABASE_WORKDIR value: %j',
    (supabaseWorkdir) => {
      expect(
        validateTrialTarget(validInput({ supabaseWorkdir })),
      ).toMatchObject({ target: 'trial', linked: true })
    },
  )

  it.each(['.', 'relative/fictional-checkout', 'C:\\fictional\\checkout'])(
    'fails closed for a non-empty SUPABASE_WORKDIR: %j',
    (supabaseWorkdir) => {
      expect(() =>
        validateTrialTarget(validInput({ supabaseWorkdir })),
      ).toThrow(safeTrialTargetError)
    },
  )

  it('withholds the rejected SUPABASE_WORKDIR value from failure text', () => {
    const fictionalWorkdir = 'C:\\FictionalUser\\another-project'
    let failure = ''
    try {
      validateTrialTarget(validInput({ supabaseWorkdir: fictionalWorkdir }))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toBe(safeTrialTargetError)
    expect(failure).not.toContain(fictionalWorkdir)
  })

  it('requires explicit supabase profile to suppress persisted-profile fallback', () => {
    // Undefined or empty values let the legacy resolver continue to the
    // user-level persisted profile. The exact env pin stops that fallback.
    expect(() =>
      validateTrialTarget(validInput({ supabaseProfile: undefined })),
    ).toThrow(safeTrialTargetError)
    expect(() =>
      validateTrialTarget(validInput({ supabaseProfile: '' })),
    ).toThrow(safeTrialTargetError)
    expect(
      validateTrialTarget(validInput({ supabaseProfile: 'supabase' })),
    ).toMatchObject({ target: 'trial', linked: true })
  })

  it.each([
    undefined,
    '',
    'supabase-staging',
    'supabase-local',
    'snap',
    'custom-profile-path',
  ])('fails closed for an unpinned SUPABASE_PROFILE: %j', (supabaseProfile) => {
    expect(() => validateTrialTarget(validInput({ supabaseProfile }))).toThrow(
      safeTrialTargetError,
    )
  })

  it('withholds the rejected SUPABASE_PROFILE value from failure text', () => {
    const fictionalProfile = 'C:\\FictionalUser\\custom-profile.yaml'
    let failure = ''
    try {
      validateTrialTarget(validInput({ supabaseProfile: fictionalProfile }))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toBe(safeTrialTargetError)
    expect(failure).not.toContain(fictionalProfile)
  })

  it('rejects unknown, duplicate, or incomplete CLI flags', () => {
    expect(() => parseTrialTargetArguments(['--production'])).toThrow(
      safeTrialTargetError,
    )
    expect(() =>
      parseTrialTargetArguments(['--target', 'trial', '--target', 'trial']),
    ).toThrow(safeTrialTargetError)
    expect(() => parseTrialTargetArguments(['--project-ref'])).toThrow(
      safeTrialTargetError,
    )
  })

  it('parses only the explicit non-mutating target-check inputs', () => {
    expect(
      parseTrialTargetArguments([
        '--target',
        'trial',
        '--confirm',
        'TRIAL',
        '--project-ref',
        trialProjectRef,
        '--allow-unlinked',
      ]),
    ).toEqual({
      target: 'trial',
      confirmation: 'TRIAL',
      projectRef: trialProjectRef,
      allowUnlinked: true,
    })
  })

  it('checks the CLI project ref against the local linked-state file', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot)

    try {
      expect(
        runTrialTargetCheck(trialArguments, repositoryRoot, trialEnvironment()),
      ).toMatchObject({ target: 'trial', linked: true })
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when the stable linked-state file is unreadable', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    const statePath = join(
      repositoryRoot,
      ...stableLinkedProjectRefRelativePath,
    )
    mkdirSync(statePath, { recursive: true })

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, trialEnvironment()),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('allows missing stable state only for the explicit pre-link gate', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, trialEnvironment()),
      ).toThrow(safeTrialTargetError)
      expect(
        runTrialTargetCheck(
          [...trialArguments, '--allow-unlinked'],
          repositoryRoot,
          trialEnvironment(),
        ),
      ).toMatchObject({ target: 'trial', linked: false })
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('does not accept next-channel project.json as stable 2.110.0 linked state', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeNextChannelState(repositoryRoot, trialProjectRef)

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, trialEnvironment()),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('uses stable linked state even when stale next-channel metadata conflicts', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)
    writeNextChannelState(repositoryRoot, otherProjectRef)

    try {
      expect(
        runTrialTargetCheck(trialArguments, repositoryRoot, trialEnvironment()),
      ).toMatchObject({ target: 'trial', linked: true })
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails safely when an environment override would change the linked target', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)

    try {
      let failure = ''
      try {
        runTrialTargetCheck(
          trialArguments,
          repositoryRoot,
          trialEnvironment({
            SUPABASE_PROJECT_ID: otherProjectRef,
          }),
        )
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      expect(failure).toBe(safeTrialTargetError)
      expect(failure).not.toContain(trialProjectRef)
      expect(failure).not.toContain(otherProjectRef)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })
  it('rejects a workdir redirect even when all project refs match', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)

    try {
      expect(() =>
        runTrialTargetCheck(
          trialArguments,
          repositoryRoot,
          trialEnvironment({
            SUPABASE_PROJECT_ID: trialProjectRef,
            SUPABASE_WORKDIR: 'fictional/other-checkout',
          }),
        ),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('accepts the fully pinned Trial execution context', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)

    try {
      expect(
        runTrialTargetCheck(
          trialArguments,
          repositoryRoot,
          trialEnvironment({
            SUPABASE_PROJECT_ID: trialProjectRef,
            SUPABASE_WORKDIR: '',
          }),
        ),
      ).toMatchObject({ target: 'trial', linked: true })
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('rejects a missing profile even when refs match and workdir is clean', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, {
          SUPABASE_PROJECT_ID: trialProjectRef,
          SUPABASE_WORKDIR: '',
        }),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('rejects a non-default profile even when refs match and workdir is clean', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))
    writeStableLinkedState(repositoryRoot, trialProjectRef)

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, {
          SUPABASE_PROJECT_ID: trialProjectRef,
          SUPABASE_WORKDIR: '',
          SUPABASE_PROFILE: 'supabase-staging',
        }),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })
})
