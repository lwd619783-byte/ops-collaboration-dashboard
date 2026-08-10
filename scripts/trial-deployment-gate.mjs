import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const safeTrialTargetError =
  'Trial deployment target check failed. Review the non-secret target inputs.'

const projectRefPattern = /^[a-z0-9]{20}$/u
const valueFlags = new Set(['--target', '--confirm', '--project-ref'])

function failTargetCheck() {
  throw new Error(safeTrialTargetError)
}

export function parseTrialTargetArguments(argv) {
  const parsed = {
    target: undefined,
    confirmation: undefined,
    projectRef: undefined,
    allowUnlinked: false,
  }
  const seen = new Set()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--allow-unlinked') {
      if (seen.has(argument)) failTargetCheck()
      seen.add(argument)
      parsed.allowUnlinked = true
      continue
    }
    if (!valueFlags.has(argument) || seen.has(argument)) failTargetCheck()
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) failTargetCheck()
    seen.add(argument)
    index += 1
    if (argument === '--target') parsed.target = value
    if (argument === '--confirm') parsed.confirmation = value
    if (argument === '--project-ref') parsed.projectRef = value
  }

  return parsed
}

export function validateTrialTarget({
  target,
  confirmation,
  projectRef,
  linkedProjectRef,
  allowUnlinked = false,
}) {
  if (target !== 'trial' || confirmation !== 'TRIAL') failTargetCheck()
  if (!projectRefPattern.test(projectRef ?? '')) failTargetCheck()

  const normalizedLinkedProjectRef = linkedProjectRef?.trim()
  if (!normalizedLinkedProjectRef) {
    if (!allowUnlinked) failTargetCheck()
    return {
      target: 'trial',
      linked: false,
      message:
        'Trial target gate passed (target=trial, linked=no, project-ref=withheld).',
    }
  }

  if (normalizedLinkedProjectRef !== projectRef) failTargetCheck()
  return {
    target: 'trial',
    linked: true,
    message:
      'Trial target gate passed (target=trial, linked=yes, project-ref=withheld).',
  }
}

export function readLinkedProjectRef(repositoryRoot) {
  try {
    return readFileSync(
      resolve(repositoryRoot, 'supabase', '.temp', 'project-ref'),
      'utf8',
    )
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }
    failTargetCheck()
  }
}

export function runTrialTargetCheck(argv, repositoryRoot = process.cwd()) {
  const parsed = parseTrialTargetArguments(argv)
  return validateTrialTarget({
    ...parsed,
    linkedProjectRef: readLinkedProjectRef(repositoryRoot),
  })
}

const executedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (executedDirectly) {
  try {
    const result = runTrialTargetCheck(process.argv.slice(2))
    process.stdout.write(result.message + '\n')
  } catch {
    process.stderr.write(safeTrialTargetError + '\n')
    process.exitCode = 1
  }
}
