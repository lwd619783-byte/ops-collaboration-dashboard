import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL, URL } from 'node:url'
import {
  parseTrialTargetArguments,
  readLinkedProjectRef,
  validateTrialTarget,
} from './trial-deployment-gate.mjs'

export const safeTrialDatabaseRouteError =
  'Trial database route check failed. Review the non-secret route inputs.'

export const stableLinkedPoolerUrlRelativePath = Object.freeze([
  'supabase',
  '.temp',
  'pooler-url',
])

// Supabase CLI 2.110.0 legacy-db-config.parse.ts and legacy-pgpass.ts read
// these connection-changing libpq variables in addition to PGPASSWORD.
// The explicit Trial URL owns every route/TLS field, so all of them must be
// absent or empty for the separate CLI command that follows this gate.
export const forbiddenAmbientPgSelectors = Object.freeze([
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

// Supabase CLI 2.110.0 reads these from the shell and nested project dotenv
// files before db push. They can bypass the prompt or disable migrations, so
// the reviewed Trial migration workflow requires both to be absent or empty.
export const forbiddenMigrationBehaviorEnvironmentKeys = Object.freeze([
  'SUPABASE_YES',
  'SUPABASE_DB_MIGRATIONS_ENABLED',
])

export const forbiddenPersistentDatabaseEnvironmentKeys = Object.freeze([
  'SUPABASE_TRIAL_DB_URL',
  'SUPABASE_DB_PASSWORD',
  'PGPASSWORD',
  ...forbiddenMigrationBehaviorEnvironmentKeys,
  ...forbiddenAmbientPgSelectors,
])

// Supabase CLI 2.110.0 legacyLoadProjectEnv walks supabase/ before the
// repository root and uses the development filename set by default. The gate
// accepts only that stable environment selection and scans this exact set.
export const stableDevelopmentProjectEnvRelativePaths = Object.freeze(
  [
    ['supabase', '.env.development.local'],
    ['supabase', '.env.local'],
    ['supabase', '.env.development'],
    ['supabase', '.env'],
    ['.env.development.local'],
    ['.env.local'],
    ['.env.development'],
    ['.env'],
  ].map((parts) => Object.freeze(parts)),
)

const projectRefPattern = /^[a-z]{20}$/u
const sharedPoolerHostPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pooler\.supabase\.com$/u

function failRouteCheck() {
  throw new Error(safeTrialDatabaseRouteError)
}

function hasUnescapedClosingQuote(value, quote, startIndex = 0) {
  for (let index = startIndex; index < value.length; index += 1) {
    if (value[index] !== quote) continue
    let precedingBackslashes = 0
    for (
      let cursor = index - 1;
      cursor >= 0 && value[cursor] === '\\';
      cursor -= 1
    ) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 === 0) return true
  }
  return false
}

function continuedQuoteForValue(value) {
  const normalized = value.trimStart()
  const quote = normalized[0]
  // Supabase CLI 2.110.0 / godotenv quoted values use single and double
  // quotes only. A backtick is an ordinary unquoted value character.
  if (!['"', "'"].includes(quote)) return undefined
  return hasUnescapedClosingQuote(normalized, quote, 1) ? undefined : quote
}

export function containsForbiddenPersistentDatabaseEnvironmentAssignment(
  contents,
) {
  if (typeof contents !== 'string') failRouteCheck()

  let continuedQuote
  for (const originalLine of contents.split(/\r?\n/u)) {
    const line = originalLine.replace(/^\uFEFF/u, '')
    if (continuedQuote !== undefined) {
      if (hasUnescapedClosingQuote(line, continuedQuote)) {
        continuedQuote = undefined
      }
      continue
    }

    if (/^\s*(?:#|$)/u.test(line)) continue
    const assignment = /^\s*(?:export\s+)?([A-Za-z0-9_.]+)\s*(?:=|:)/u.exec(
      line,
    )
    if (assignment === null) continue
    if (forbiddenPersistentDatabaseEnvironmentKeys.includes(assignment[1])) {
      return true
    }
    continuedQuote = continuedQuoteForValue(line.slice(assignment[0].length))
  }
  return false
}

export function validateTrialDatabaseProjectEnvironment(environment) {
  const projectEnvironment = environment.SUPABASE_ENV
  if (
    projectEnvironment !== undefined &&
    projectEnvironment !== '' &&
    projectEnvironment !== 'development'
  ) {
    failRouteCheck()
  }
  return true
}

export function validateNoMigrationBehaviorEnvironmentOverrides(environment) {
  for (const key of forbiddenMigrationBehaviorEnvironmentKeys) {
    const value = environment[key]
    if (value !== undefined && value !== '') failRouteCheck()
  }
  return true
}

export function validateNoPersistentDatabaseRouteSelectors(
  repositoryRoot,
  environment = process.env,
) {
  validateTrialDatabaseProjectEnvironment(environment)
  for (const relativePath of stableDevelopmentProjectEnvRelativePaths) {
    let contents
    try {
      contents = readFileSync(resolve(repositoryRoot, ...relativePath), 'utf8')
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue
      }
      failRouteCheck()
    }
    if (containsForbiddenPersistentDatabaseEnvironmentAssignment(contents)) {
      failRouteCheck()
    }
  }
  return true
}

function rawUrlUserinfo(value) {
  const schemeEnd = value.indexOf('://')
  if (schemeEnd < 0) failRouteCheck()
  const afterScheme = value.slice(schemeEnd + 3)
  const authorityEnd = afterScheme.search(/[/?#]/u)
  const authority =
    authorityEnd < 0 ? afterScheme : afterScheme.slice(0, authorityEnd)
  const separator = authority.lastIndexOf('@')
  if (separator <= 0) failRouteCheck()
  return authority.slice(0, separator)
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    failRouteCheck()
  }
}

export function canonicalizeTrialPoolerUrl(value, { projectRef, operator }) {
  if (typeof value !== 'string' || value.length === 0) failRouteCheck()
  if (!projectRefPattern.test(projectRef ?? '')) failRouteCheck()

  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) failRouteCheck()

  let url
  try {
    url = new URL(normalizedValue)
  } catch {
    failRouteCheck()
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) failRouteCheck()
  if (url.hash !== '') failRouteCheck()

  // WHATWG URL cannot distinguish `user@host` from `user:@host` through
  // url.password alone. Inspect the raw authority and reject any password
  // separator, including an explicitly empty password field.
  const userinfo = rawUrlUserinfo(normalizedValue)
  if (userinfo.includes(':') || url.searchParams.has('password')) {
    failRouteCheck()
  }

  const username = decodeUrlComponent(url.username)
  const expectedUsername = `postgres.${projectRef}`
  const hostname = url.hostname.toLowerCase()
  const database = decodeUrlComponent(url.pathname)

  if (username !== expectedUsername) failRouteCheck()
  if (!sharedPoolerHostPattern.test(hostname)) failRouteCheck()
  if (url.port !== '5432') failRouteCheck()
  if (database !== '/postgres') failRouteCheck()

  const queryEntries = [...url.searchParams.entries()]
  if (operator) {
    if (
      queryEntries.length !== 1 ||
      queryEntries[0]?.[0] !== 'sslmode' ||
      queryEntries[0]?.[1] !== 'require'
    ) {
      failRouteCheck()
    }
  } else if (
    queryEntries.length > 0 &&
    (queryEntries.length !== 1 ||
      queryEntries[0]?.[0] !== 'sslmode' ||
      queryEntries[0]?.[1] !== 'require')
  ) {
    failRouteCheck()
  }

  return Object.freeze({
    protocol: 'postgresql',
    username,
    hostname,
    port: 5432,
    database: 'postgres',
  })
}

export function validateTrialDatabaseRoute({
  projectRef,
  linkedPoolerUrl,
  environment,
}) {
  validateTrialDatabaseProjectEnvironment(environment)
  validateNoMigrationBehaviorEnvironmentOverrides(environment)
  const password = environment.PGPASSWORD
  if (password === undefined || password === '') failRouteCheck()
  if (
    environment.SUPABASE_DB_PASSWORD !== undefined &&
    environment.SUPABASE_DB_PASSWORD !== ''
  ) {
    failRouteCheck()
  }
  for (const selector of forbiddenAmbientPgSelectors) {
    const value = environment[selector]
    if (value !== undefined && value !== '') failRouteCheck()
  }

  const linked = canonicalizeTrialPoolerUrl(linkedPoolerUrl, {
    projectRef,
    operator: false,
  })
  const operator = canonicalizeTrialPoolerUrl(
    environment.SUPABASE_TRIAL_DB_URL,
    { projectRef, operator: true },
  )

  for (const key of ['protocol', 'username', 'hostname', 'port', 'database']) {
    if (linked[key] !== operator[key]) failRouteCheck()
  }

  return {
    target: 'trial',
    linked: true,
    route: 'session-pooler',
    port: 5432,
    tls: 'require',
    database: 'postgres',
    message:
      'Trial database route gate passed (target=trial, linked=yes, route=session-pooler, port=5432, tls=require, db-url=withheld).',
  }
}

export function readLinkedPoolerUrl(repositoryRoot) {
  try {
    return readFileSync(
      resolve(repositoryRoot, ...stableLinkedPoolerUrlRelativePath),
      'utf8',
    )
  } catch {
    failRouteCheck()
  }
}

export function runTrialDatabaseRouteCheck(
  argv,
  repositoryRoot = process.cwd(),
  environment = process.env,
) {
  let parsed
  try {
    parsed = parseTrialTargetArguments(argv)
    if (parsed.allowUnlinked) failRouteCheck()
    const identity = validateTrialTarget({
      ...parsed,
      linkedProjectRef: readLinkedProjectRef(repositoryRoot),
      supabaseProjectId: environment.SUPABASE_PROJECT_ID,
      supabaseWorkdir: environment.SUPABASE_WORKDIR,
      supabaseProfile: environment.SUPABASE_PROFILE,
    })
    if (!identity.linked) failRouteCheck()
  } catch {
    failRouteCheck()
  }

  validateNoPersistentDatabaseRouteSelectors(repositoryRoot, environment)

  return validateTrialDatabaseRoute({
    projectRef: parsed.projectRef,
    linkedPoolerUrl: readLinkedPoolerUrl(repositoryRoot),
    environment,
  })
}

const executedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (executedDirectly) {
  try {
    const result = runTrialDatabaseRouteCheck(process.argv.slice(2))
    process.stdout.write(result.message + '\n')
  } catch {
    process.stderr.write(safeTrialDatabaseRouteError + '\n')
    process.exitCode = 1
  }
}
