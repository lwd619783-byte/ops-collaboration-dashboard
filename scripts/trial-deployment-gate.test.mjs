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
        runTrialTargetCheck(trialArguments, repositoryRoot, {}),
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
        runTrialTargetCheck(trialArguments, repositoryRoot, {}),
      ).toThrow(safeTrialTargetError)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('allows missing stable state only for the explicit pre-link gate', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'trial-gate-'))

    try {
      expect(() =>
        runTrialTargetCheck(trialArguments, repositoryRoot, {}),
      ).toThrow(safeTrialTargetError)
      expect(
        runTrialTargetCheck(
          [...trialArguments, '--allow-unlinked'],
          repositoryRoot,
          {},
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
        runTrialTargetCheck(trialArguments, repositoryRoot, {}),
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
        runTrialTargetCheck(trialArguments, repositoryRoot, {}),
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
        runTrialTargetCheck(trialArguments, repositoryRoot, {
          SUPABASE_PROJECT_ID: otherProjectRef,
        })
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
})
