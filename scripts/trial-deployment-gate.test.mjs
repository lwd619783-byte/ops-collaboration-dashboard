import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseTrialTargetArguments,
  runTrialTargetCheck,
  safeTrialTargetError,
  validateTrialTarget,
} from './trial-deployment-gate.mjs'

const trialProjectRef = 'abcdefghijklmnopqrst'

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

  it.each([
    { target: undefined },
    { confirmation: undefined },
    { projectRef: undefined },
    { projectRef: 'short-ref' },
    { linkedProjectRef: undefined },
    { linkedProjectRef: 'zyxwvutsrqponmlkjihg' },
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

    const otherRef = 'zyxwvutsrqponmlkjihg'
    let failure = ''
    try {
      validateTrialTarget(validInput({ linkedProjectRef: otherRef }))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toBe(safeTrialTargetError)
    expect(failure).not.toContain(trialProjectRef)
    expect(failure).not.toContain(otherRef)
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
    const tempState = join(repositoryRoot, 'supabase', '.temp')
    mkdirSync(tempState, { recursive: true })
    writeFileSync(
      join(tempState, 'project-ref'),
      trialProjectRef + '\n',
      'utf8',
    )

    try {
      expect(
        runTrialTargetCheck(
          [
            '--target',
            'trial',
            '--confirm',
            'TRIAL',
            '--project-ref',
            trialProjectRef,
          ],
          repositoryRoot,
        ),
      ).toMatchObject({ target: 'trial', linked: true })
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })
})
