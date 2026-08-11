import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const safeTrialTargetError =
  'Trial deployment target check failed. Review the non-secret target inputs.'

export const stableSupabaseCliVersion = '2.110.0'
export const stableLinkedProjectRefRelativePath = Object.freeze([
  'supabase',
  '.temp',
  'project-ref',
])

const projectRefPattern = /^[a-z]{20}$/u
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
  supabaseProjectId,
  supabaseWorkdir,
  supabaseProfile,
  allowUnlinked = false,
}) {
  if (target !== 'trial' || confirmation !== 'TRIAL') failTargetCheck()
  if (!projectRefPattern.test(projectRef ?? '')) failTargetCheck()

  // Trial commands must run from this repository checkout with the default
  // Supabase API profile. Any non-empty ambient selector could make the CLI
  // resolve a different workdir, linked-state file, or control plane.
  if (supabaseWorkdir !== undefined && supabaseWorkdir !== '') {
    failTargetCheck()
  }
  if (supabaseProfile !== undefined && supabaseProfile !== '') {
    failTargetCheck()
  }

  // Stable Supabase CLI 2.110.0 resolves linked commands in this order:
  // SUPABASE_PROJECT_ID, then supabase/.temp/project-ref. An environment
  // override must therefore agree with the separately confirmed Trial ref.
  if (
    supabaseProjectId !== undefined &&
    supabaseProjectId !== '' &&
    (!projectRefPattern.test(supabaseProjectId) ||
      supabaseProjectId !== projectRef)
  ) {
    failTargetCheck()
  }

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
      resolve(repositoryRoot, ...stableLinkedProjectRefRelativePath),
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

export function runTrialTargetCheck(
  argv,
  repositoryRoot = process.cwd(),
  environment = process.env,
) {
  const parsed = parseTrialTargetArguments(argv)
  return validateTrialTarget({
    ...parsed,
    linkedProjectRef: readLinkedProjectRef(repositoryRoot),
    supabaseProjectId: environment.SUPABASE_PROJECT_ID,
    supabaseWorkdir: environment.SUPABASE_WORKDIR,
    supabaseProfile: environment.SUPABASE_PROFILE,
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
