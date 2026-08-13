#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node recovery operator */
/**
 * Recovery Auth Tenant Rebind Procedure V1.
 *
 * This is an offline, operator-only database procedure. It creates no RPC,
 * Edge Function or browser surface. PLAN and APPLY are separate invocations;
 * APPLY re-runs every guard in a serializable transaction and only appends a
 * target-tenant identity.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  canonicalizeTrialPoolerUrl,
  forbiddenAmbientPgSelectors,
  forbiddenMigrationBehaviorEnvironmentKeys,
  readLinkedPoolerUrl,
  stableDevelopmentProjectEnvRelativePaths,
} from '../trial-database-route-gate.mjs'
import { readLinkedProjectRef } from '../trial-deployment-gate.mjs'

export const recoveryProcedureVersion = 1
export const safeRecoveryFailure =
  'Recovery identity rebind failed. Review the static failure code and controlled evidence.'

export const recoveryConfirmations = Object.freeze({
  target: 'RECOVERY',
  apply: 'APPLY_RECOVERY_IDENTITY_REBIND',
  classification: 'ISOLATED_RECOVERY_TARGET',
  authorization: 'AUTHORIZED_RECOVERY_REBIND_V1',
  authentication: 'AUTHENTICATED_RECOVERY_SESSION_VERIFIED',
  noProduction: 'NOT_CONFIGURED',
})

const projectRefPattern = /^[a-z]{20}$/u
const migrationVersionPattern = /^\d{14}$/u
const migrationCountPattern = /^[1-9]\d*$/u
const systemIdentifierPattern = /^\d{10,24}$/u
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const digestPattern = /^[0-9a-f]{64}$/u
const valueFlags = new Set([
  '--mode',
  '--confirm',
  '--plan-digest',
  '--confirm-apply',
])

export class RecoveryRebindError extends Error {
  constructor(code) {
    super(code)
    this.name = 'RecoveryRebindError'
    this.code = code
  }
}

function fail(code) {
  throw new RecoveryRebindError(code)
}

function present(value) {
  return typeof value === 'string' && value.length > 0
}

function requireExact(value, expected, code) {
  if (value !== expected) fail(code)
}

function requirePattern(value, pattern, code) {
  if (!present(value) || !pattern.test(value)) fail(code)
  return value
}

export function canonicalIssuerForProjectRef(projectRef) {
  requirePattern(projectRef, projectRefPattern, 'target_project_ref_invalid')
  return `https://${projectRef}.supabase.co/auth/v1`
}

export function projectRefFromCanonicalIssuer(issuer) {
  if (!present(issuer) || issuer !== issuer.trim()) {
    fail('issuer_invalid')
  }
  const match = /^https:\/\/([a-z]{20})\.supabase\.co\/auth\/v1$/u.exec(issuer)
  if (match === null) fail('issuer_invalid')
  return match[1]
}

export function parseRecoveryRebindArguments(argv) {
  const parsed = {
    mode: undefined,
    confirmation: undefined,
    planDigest: undefined,
    applyConfirmation: undefined,
  }
  const seen = new Set()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!valueFlags.has(argument) || seen.has(argument)) {
      fail('arguments_invalid')
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail('arguments_invalid')
    seen.add(argument)
    index += 1
    if (argument === '--mode') parsed.mode = value
    if (argument === '--confirm') parsed.confirmation = value
    if (argument === '--plan-digest') parsed.planDigest = value
    if (argument === '--confirm-apply') parsed.applyConfirmation = value
  }

  if (!['plan', 'apply'].includes(parsed.mode)) fail('mode_invalid')
  requireExact(
    parsed.confirmation,
    recoveryConfirmations.target,
    'target_confirmation_invalid',
  )
  if (parsed.mode === 'plan') {
    if (
      parsed.planDigest !== undefined ||
      parsed.applyConfirmation !== undefined
    ) {
      fail('plan_arguments_invalid')
    }
  } else {
    requirePattern(parsed.planDigest, digestPattern, 'plan_digest_invalid')
    requireExact(
      parsed.applyConfirmation,
      recoveryConfirmations.apply,
      'apply_confirmation_invalid',
    )
  }
  return parsed
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
  if (!['"', "'"].includes(quote)) return undefined
  return hasUnescapedClosingQuote(normalized, quote, 1) ? undefined : quote
}

function isForbiddenPersistentKey(key) {
  return (
    key.startsWith('RECOVERY_') ||
    key === 'PGPASSWORD' ||
    key === 'SUPABASE_DB_PASSWORD' ||
    key === 'SUPABASE_PROJECT_ID' ||
    key === 'SUPABASE_WORKDIR' ||
    key === 'SUPABASE_PROFILE' ||
    key === 'SUPABASE_ENV' ||
    forbiddenAmbientPgSelectors.includes(key) ||
    forbiddenMigrationBehaviorEnvironmentKeys.includes(key)
  )
}

export function containsForbiddenRecoveryEnvironmentAssignment(contents) {
  if (typeof contents !== 'string') fail('persistent_environment_unreadable')

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
    if (isForbiddenPersistentKey(assignment[1])) return true
    continuedQuote = continuedQuoteForValue(line.slice(assignment[0].length))
  }
  return false
}

export function validateNoPersistentRecoveryEnvironment(
  repositoryRoot,
  readFile = readFileSync,
) {
  for (const relativePath of stableDevelopmentProjectEnvRelativePaths) {
    let contents
    try {
      contents = readFile(resolve(repositoryRoot, ...relativePath), 'utf8')
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue
      }
      fail('persistent_environment_unreadable')
    }
    if (containsForbiddenRecoveryEnvironmentAssignment(contents)) {
      fail('persistent_environment_forbidden')
    }
  }
  return true
}

export function validateRecoveryOperatorInputs({
  environment,
  linkedProjectRef,
  linkedPoolerUrl,
}) {
  requireExact(
    environment.RECOVERY_TARGET_CLASSIFICATION,
    recoveryConfirmations.classification,
    'target_classification_invalid',
  )
  requireExact(
    environment.RECOVERY_OPERATOR_AUTHORIZATION,
    recoveryConfirmations.authorization,
    'operator_authorization_missing',
  )
  requireExact(
    environment.RECOVERY_AUTHENTICATION_EVIDENCE,
    recoveryConfirmations.authentication,
    'authentication_evidence_missing',
  )

  const targetProjectRef = requirePattern(
    environment.RECOVERY_TARGET_PROJECT_REF,
    projectRefPattern,
    'target_project_ref_invalid',
  )
  const activeTrialProjectRef = requirePattern(
    environment.RECOVERY_ACTIVE_TRIAL_PROJECT_REF,
    projectRefPattern,
    'active_trial_project_ref_invalid',
  )
  const productionProjectRef = environment.RECOVERY_PRODUCTION_PROJECT_REF
  if (
    productionProjectRef !== recoveryConfirmations.noProduction &&
    !projectRefPattern.test(productionProjectRef ?? '')
  ) {
    fail('production_project_ref_invalid')
  }

  const sourceIssuer = environment.RECOVERY_SOURCE_ISSUER
  const targetIssuer = environment.RECOVERY_TARGET_ISSUER
  const sourceProjectRef = projectRefFromCanonicalIssuer(sourceIssuer)
  const targetIssuerProjectRef = projectRefFromCanonicalIssuer(targetIssuer)
  if (sourceProjectRef !== activeTrialProjectRef) {
    fail('source_trial_mismatch')
  }
  if (targetIssuerProjectRef !== targetProjectRef) {
    fail('target_issuer_mismatch')
  }
  if (targetProjectRef === activeTrialProjectRef)
    fail('active_trial_target_denied')
  if (
    productionProjectRef !== recoveryConfirmations.noProduction &&
    targetProjectRef === productionProjectRef
  ) {
    fail('production_target_denied')
  }
  if (sourceIssuer === targetIssuer || sourceProjectRef === targetProjectRef) {
    fail('source_target_same')
  }

  requirePattern(
    environment.RECOVERY_AUTH_SUBJECT,
    uuidPattern,
    'auth_subject_invalid',
  )
  requirePattern(
    environment.RECOVERY_EXPECTED_SYSTEM_IDENTIFIER,
    systemIdentifierPattern,
    'system_identifier_invalid',
  )
  requirePattern(
    environment.RECOVERY_EXPECTED_LATEST_MIGRATION,
    migrationVersionPattern,
    'latest_migration_invalid',
  )
  requirePattern(
    environment.RECOVERY_EXPECTED_MIGRATION_COUNT,
    migrationCountPattern,
    'migration_count_invalid',
  )

  requireExact(environment.SUPABASE_PROFILE, 'supabase', 'profile_invalid')
  if (present(environment.SUPABASE_WORKDIR)) fail('workdir_override_denied')
  if (
    present(environment.SUPABASE_PROJECT_ID) &&
    environment.SUPABASE_PROJECT_ID !== targetProjectRef
  ) {
    fail('project_override_mismatch')
  }
  if (
    present(environment.SUPABASE_ENV) &&
    environment.SUPABASE_ENV !== 'development'
  ) {
    fail('project_environment_invalid')
  }
  for (const key of forbiddenMigrationBehaviorEnvironmentKeys) {
    if (present(environment[key])) fail('migration_behavior_override_denied')
  }
  if (present(environment.SUPABASE_DB_PASSWORD)) {
    fail('database_password_source_invalid')
  }
  if (
    present(environment.SUPABASE_TRIAL_DB_URL) ||
    present(environment.SUPABASE_TRIAL_PROJECT_REF)
  ) {
    fail('active_trial_route_context_denied')
  }
  if (!present(environment.PGPASSWORD)) fail('database_password_missing')
  for (const key of forbiddenAmbientPgSelectors) {
    if (present(environment[key])) fail('database_route_override_denied')
  }

  if (linkedProjectRef?.trim() !== targetProjectRef) {
    fail('linked_project_mismatch')
  }
  let linkedRoute
  let operatorRoute
  try {
    linkedRoute = canonicalizeTrialPoolerUrl(linkedPoolerUrl, {
      projectRef: targetProjectRef,
      operator: false,
    })
    operatorRoute = canonicalizeTrialPoolerUrl(environment.RECOVERY_DB_URL, {
      projectRef: targetProjectRef,
      operator: true,
    })
  } catch {
    fail('database_route_invalid')
  }
  for (const key of ['protocol', 'username', 'hostname', 'port', 'database']) {
    if (linkedRoute[key] !== operatorRoute[key]) fail('database_route_mismatch')
  }

  return Object.freeze({
    sourceIssuer,
    targetIssuer,
    subject: environment.RECOVERY_AUTH_SUBJECT,
    targetProjectRef,
    expectedSystemIdentifier: environment.RECOVERY_EXPECTED_SYSTEM_IDENTIFIER,
    expectedLatestMigration: environment.RECOVERY_EXPECTED_LATEST_MIGRATION,
    expectedMigrationCount: Number(
      environment.RECOVERY_EXPECTED_MIGRATION_COUNT,
    ),
    authenticationEvidence: environment.RECOVERY_AUTHENTICATION_EVIDENCE,
    operatorAuthorization: environment.RECOVERY_OPERATOR_AUTHORIZATION,
    targetClassification: environment.RECOVERY_TARGET_CLASSIFICATION,
    route: operatorRoute,
    password: environment.PGPASSWORD,
  })
}

export function loadRecoveryOperatorInputs(
  repositoryRoot = process.cwd(),
  environment = process.env,
) {
  validateNoPersistentRecoveryEnvironment(repositoryRoot)
  return validateRecoveryOperatorInputs({
    environment,
    linkedProjectRef: readLinkedProjectRef(repositoryRoot),
    linkedPoolerUrl: readLinkedPoolerUrl(repositoryRoot),
  })
}

export function validateRecoveryCoreInput(input) {
  const sourceRef = projectRefFromCanonicalIssuer(input.sourceIssuer)
  const targetRef = projectRefFromCanonicalIssuer(input.targetIssuer)
  if (sourceRef === targetRef || input.sourceIssuer === input.targetIssuer) {
    fail('source_target_same')
  }
  requirePattern(input.subject, uuidPattern, 'auth_subject_invalid')
  requirePattern(
    input.expectedSystemIdentifier,
    systemIdentifierPattern,
    'system_identifier_invalid',
  )
  requirePattern(
    input.expectedLatestMigration,
    migrationVersionPattern,
    'latest_migration_invalid',
  )
  if (
    !Number.isSafeInteger(input.expectedMigrationCount) ||
    input.expectedMigrationCount < 1
  ) {
    fail('migration_count_invalid')
  }
  requireExact(
    input.authenticationEvidence,
    recoveryConfirmations.authentication,
    'authentication_evidence_missing',
  )
  requireExact(
    input.operatorAuthorization,
    recoveryConfirmations.authorization,
    'operator_authorization_missing',
  )
  requireExact(
    input.targetClassification,
    recoveryConfirmations.classification,
    'target_classification_invalid',
  )
  return true
}

async function assertRecoveryDatabaseTarget(client, input) {
  let result
  try {
    result = await client.query(
      `select current_database()::text as database_name,
              (select system_identifier::text from pg_control_system()) as system_identifier,
              (select count(*)::int from supabase_migrations.schema_migrations) as migration_count,
              (select version::text
                 from supabase_migrations.schema_migrations
                order by version desc
                limit 1) as latest_migration,
              to_regclass('public.app_users') is not null as app_users_exists,
              to_regclass('public.user_identities') is not null as identities_exists,
              to_regprocedure('public.current_app_user_id()') is not null as current_resolver_exists,
              to_regprocedure(
                'public.resolve_app_user_id(public.identity_provider,text,text)'
              ) is not null as resolver_exists`,
    )
  } catch {
    fail('target_evidence_query_failed')
  }
  const row = result.rows[0]
  if (
    result.rowCount !== 1 ||
    row?.database_name !== 'postgres' ||
    row?.system_identifier !== input.expectedSystemIdentifier ||
    row?.migration_count !== input.expectedMigrationCount ||
    row?.latest_migration !== input.expectedLatestMigration ||
    row?.app_users_exists !== true ||
    row?.identities_exists !== true ||
    row?.current_resolver_exists !== true ||
    row?.resolver_exists !== true
  ) {
    fail('recovery_database_target_unproven')
  }
}

async function identityRows(client, tenant, subject) {
  const result = await client.query(
    `select i.id::text as identity_id,
            i.user_id::text as user_id,
            i.provider::text as provider,
            i.provider_tenant,
            i.provider_subject,
            i.verified_at,
            i.revoked_at,
            i.created_at,
            i.updated_at,
            i.last_used_at,
            u.status::text as user_status
       from public.user_identities as i
       join public.app_users as u on u.id = i.user_id
      where i.provider = 'supabase_auth'
        and i.provider_tenant = $1
        and i.provider_subject = $2`,
    [tenant, subject],
  )
  return result.rows
}

function rebindDigest(input, state) {
  const material = JSON.stringify({
    procedureVersion: recoveryProcedureVersion,
    sourceIssuer: input.sourceIssuer,
    targetIssuer: input.targetIssuer,
    subject: input.subject,
    action: state.action,
    sourceIdentityId: state.source.identity_id,
    targetIdentityId: state.target?.identity_id ?? null,
    userId: state.source.user_id,
    systemIdentifier: input.expectedSystemIdentifier,
    migrationCount: input.expectedMigrationCount,
    latestMigration: input.expectedLatestMigration,
  })
  return createHash('sha256').update(material, 'utf8').digest('hex')
}

function safePlan(state) {
  return Object.freeze({
    procedure_version: recoveryProcedureVersion,
    mode: 'PLAN',
    status: 'PASS',
    mutation_performed: false,
    safe_rebind_count: state.action === 'insert' ? 1 : 0,
    idempotent_noop_count: state.action === 'noop' ? 1 : 0,
    source_identity_count: 1,
    source_identity_verified: true,
    source_identity_live: true,
    source_app_user_active: true,
    auth_subject_present: true,
    subject_owner_count: 1,
    target_conflict_count: 0,
    source_target_distinct: true,
    recovery_target_verified: true,
    plan_digest: state.planDigest,
  })
}

function safeApply(state, inserted) {
  return Object.freeze({
    procedure_version: recoveryProcedureVersion,
    mode: 'APPLY',
    status: 'PASS',
    mutation_performed: inserted,
    identities_inserted: inserted ? 1 : 0,
    idempotent_noop_count: inserted ? 0 : 1,
    source_identity_preserved: true,
    source_resolution_preserved: true,
    target_resolution_verified: true,
    plan_digest: state.planDigest,
  })
}

export async function inspectRecoveryAuthTenantRebind(
  client,
  input,
  { lock = false } = {},
) {
  validateRecoveryCoreInput(input)
  await assertRecoveryDatabaseTarget(client, input)

  if (lock) {
    await client.query(
      'lock table public.user_identities in share row exclusive mode',
    )
  }

  const sourceRows = await identityRows(
    client,
    input.sourceIssuer,
    input.subject,
  )
  if (sourceRows.length === 0) fail('source_identity_missing')
  if (sourceRows.length !== 1) fail('source_identity_ambiguous')
  const source = sourceRows[0]
  if (source.verified_at === null) fail('source_identity_unverified')
  if (source.revoked_at !== null) fail('source_identity_revoked')
  if (source.user_status !== 'active') fail('source_app_user_inactive')

  if (lock) {
    const lockedUser = await client.query(
      `select status::text as user_status
         from public.app_users
        where id = $1::uuid
        for update`,
      [source.user_id],
    )
    if (
      lockedUser.rowCount !== 1 ||
      lockedUser.rows[0]?.user_status !== 'active'
    ) {
      fail('source_app_user_inactive')
    }
  }

  const authUser = await client.query(
    `select id::text as auth_user_id
       from auth.users
      where id = $1::uuid
      ${lock ? 'for update' : ''}`,
    [input.subject],
  )
  if (authUser.rowCount !== 1) fail('recovery_auth_subject_missing')

  const targetRows = await identityRows(
    client,
    input.targetIssuer,
    input.subject,
  )
  if (targetRows.length > 1) fail('target_identity_ambiguous')
  let action = 'insert'
  if (targetRows.length === 1) {
    const target = targetRows[0]
    if (target.user_id !== source.user_id) fail('target_identity_conflict')
    if (target.verified_at === null || target.revoked_at !== null) {
      fail('target_identity_not_live')
    }
    action = 'noop'
  }

  const owners = await client.query(
    `select count(distinct i.user_id)::int as owner_count
       from public.user_identities as i
       join public.app_users as u on u.id = i.user_id
      where i.provider = 'supabase_auth'
        and i.provider_subject = $1
        and i.verified_at is not null
        and i.revoked_at is null
        and u.status = 'active'`,
    [input.subject],
  )
  if (owners.rows[0]?.owner_count !== 1) fail('subject_ownership_ambiguous')

  const sourceResolution = await client.query(
    `select public.resolve_app_user_id('supabase_auth', $1, $2)::text as user_id`,
    [input.sourceIssuer, input.subject],
  )
  if (sourceResolution.rows[0]?.user_id !== source.user_id) {
    fail('source_resolution_mismatch')
  }

  const state = {
    action,
    source,
    target: targetRows[0],
  }
  return Object.freeze({
    ...state,
    planDigest: rebindDigest(input, state),
  })
}

export async function planRecoveryAuthTenantRebind(client, input) {
  await client.query('begin isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout = '30s'")
    const state = await inspectRecoveryAuthTenantRebind(client, input)
    await client.query('rollback')
    return safePlan(state)
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

function digestsEqual(left, right) {
  if (!digestPattern.test(left ?? '') || !digestPattern.test(right ?? '')) {
    return false
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

async function currentAppUserForClaims(client, issuer, subject) {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ iss: issuer, sub: subject, role: 'authenticated' }),
  ])
  const result = await client.query(
    'select public.current_app_user_id()::text as user_id',
  )
  return result.rows[0]?.user_id ?? null
}

export async function applyRecoveryAuthTenantRebindInTransaction(
  client,
  input,
  reviewedPlanDigest,
) {
  const state = await inspectRecoveryAuthTenantRebind(client, input, {
    lock: true,
  })
  if (!digestsEqual(state.planDigest, reviewedPlanDigest)) {
    fail('reviewed_plan_mismatch')
  }

  const sourceBefore = JSON.stringify(state.source)
  const targetBefore = JSON.stringify(state.target)
  let inserted = false
  if (state.action === 'insert') {
    const result = await client.query(
      `with evidence_time as (
         select clock_timestamp() as verified_at
       )
       insert into public.user_identities (
         user_id,
         provider,
         provider_tenant,
         provider_subject,
         verified_at,
         last_used_at
       )
       select $1::uuid,
              'supabase_auth'::public.identity_provider,
              $2::text,
              $3::text,
              evidence_time.verified_at,
              null::timestamptz
         from evidence_time
       returning id`,
      [state.source.user_id, input.targetIssuer, input.subject],
    )
    if (result.rowCount !== 1) fail('identity_insert_failed')
    inserted = true
  }

  const sourceAfter = await identityRows(
    client,
    input.sourceIssuer,
    input.subject,
  )
  const targetAfter = await identityRows(
    client,
    input.targetIssuer,
    input.subject,
  )
  if (
    sourceAfter.length !== 1 ||
    JSON.stringify(sourceAfter[0]) !== sourceBefore ||
    targetAfter.length !== 1 ||
    targetAfter[0]?.user_id !== state.source.user_id ||
    targetAfter[0]?.verified_at === null ||
    targetAfter[0]?.revoked_at !== null ||
    (inserted && targetAfter[0]?.last_used_at !== null) ||
    (!inserted && JSON.stringify(targetAfter[0]) !== targetBefore)
  ) {
    fail('post_apply_identity_verification_failed')
  }

  const sourceResolved = await currentAppUserForClaims(
    client,
    input.sourceIssuer,
    input.subject,
  )
  const targetResolved = await currentAppUserForClaims(
    client,
    input.targetIssuer,
    input.subject,
  )
  if (
    sourceResolved !== state.source.user_id ||
    targetResolved !== state.source.user_id
  ) {
    fail('post_apply_resolution_failed')
  }

  return safeApply(state, inserted)
}

export async function applyRecoveryAuthTenantRebind(
  client,
  input,
  reviewedPlanDigest,
) {
  await client.query('begin isolation level serializable')
  try {
    await client.query("set local lock_timeout = '5s'")
    await client.query("set local statement_timeout = '30s'")
    await client.query("set local idle_in_transaction_session_timeout = '60s'")
    const result = await applyRecoveryAuthTenantRebindInTransaction(
      client,
      input,
      reviewedPlanDigest,
    )
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

function connectionConfig(operatorInputs) {
  return {
    host: operatorInputs.route.hostname,
    port: operatorInputs.route.port,
    user: operatorInputs.route.username,
    database: operatorInputs.route.database,
    password: operatorInputs.password,
    ssl: { rejectUnauthorized: true },
    application_name: 'recovery-auth-tenant-rebind-v1',
    connectionTimeoutMillis: 10_000,
  }
}

export async function runRecoveryAuthTenantRebind(
  argv,
  repositoryRoot = process.cwd(),
  environment = process.env,
) {
  const args = parseRecoveryRebindArguments(argv)
  const operatorInputs = loadRecoveryOperatorInputs(repositoryRoot, environment)
  const requireFromRepository = createRequire(
    join(repositoryRoot, 'package.json'),
  )
  const { Client } = requireFromRepository('pg')
  const client = new Client(connectionConfig(operatorInputs))
  try {
    await client.connect()
    if (args.mode === 'plan') {
      return await planRecoveryAuthTenantRebind(client, operatorInputs)
    }
    return await applyRecoveryAuthTenantRebind(
      client,
      operatorInputs,
      args.planDigest,
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

const modulePath = fileURLToPath(import.meta.url)
const executedDirectly =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(modulePath).href

if (executedDirectly) {
  try {
    const result = await runRecoveryAuthTenantRebind(process.argv.slice(2))
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    const code =
      error instanceof RecoveryRebindError
        ? error.code
        : 'database_operation_failed'
    process.stderr.write(`${safeRecoveryFailure} code=${code}\n`)
    process.exitCode = 1
  }
}
