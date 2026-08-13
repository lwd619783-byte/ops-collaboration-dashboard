#!/usr/bin/env node
/* eslint-disable no-undef -- standalone local database integration verifier */
/**
 * Local-only regression verifier for Recovery Auth Tenant Rebind V1.
 *
 * The script obtains its connection exclusively from `supabase status`,
 * requires loopback local endpoints and uses only synthetic identities. It
 * never loads operator Recovery environment variables and never connects to a
 * hosted project.
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RecoveryRebindError,
  applyRecoveryAuthTenantRebind,
  applyRecoveryAuthTenantRebindInTransaction,
  inspectRecoveryAuthTenantRebind,
  planRecoveryAuthTenantRebind,
  recoveryConfirmations,
} from './recovery-auth-tenant-rebind.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const requireFromRepository = createRequire(
  join(repositoryRoot, 'package.json'),
)
const { Client } = requireFromRepository('pg')
const supabaseCli = join(
  repositoryRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
)

const sourceIssuer = `https://${'a'.repeat(20)}.supabase.co/auth/v1`
const targetIssuer = `https://${'b'.repeat(20)}.supabase.co/auth/v1`
const thirdIssuer = `https://${'d'.repeat(20)}.supabase.co/auth/v1`

let checkCount = 0
const failures = []

function check(name, condition) {
  checkCount += 1
  if (!condition) failures.push(name)
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${name}`)
}

function localStatus() {
  const result = spawnSync(
    process.execPath,
    [supabaseCli, 'status', '-o', 'json'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DO_NOT_TRACK: '1',
        SUPABASE_PROFILE: 'supabase',
        SUPABASE_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (result.error || result.status !== 0) {
    throw new Error('Local Supabase status failed.')
  }
  return JSON.parse(result.stdout)
}

function requireLoopbackUrl(value, protocols) {
  const url = new URL(value)
  if (!protocols.includes(url.protocol)) throw new Error('Local URL invalid.')
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Recovery verifier refuses non-loopback targets.')
  }
}

async function databaseEvidence(client) {
  const result = await client.query(
    `select (select system_identifier::text from pg_control_system()) as system_identifier,
            (select count(*)::int from supabase_migrations.schema_migrations) as migration_count,
            (select version::text
               from supabase_migrations.schema_migrations
              order by version desc
              limit 1) as latest_migration`,
  )
  const evidence = result.rows[0]
  if (
    !evidence?.system_identifier ||
    !Number.isSafeInteger(evidence.migration_count) ||
    !evidence.latest_migration
  ) {
    throw new Error('Local database evidence unavailable.')
  }
  return evidence
}

function recoveryInput(evidence, subject) {
  return {
    sourceIssuer,
    targetIssuer,
    subject,
    expectedSystemIdentifier: evidence.system_identifier,
    expectedMigrationCount: evidence.migration_count,
    expectedLatestMigration: evidence.latest_migration,
    authenticationEvidence: recoveryConfirmations.authentication,
    operatorAuthorization: recoveryConfirmations.authorization,
    targetClassification: recoveryConfirmations.classification,
  }
}

async function insertAppUser(
  client,
  { userId = randomUUID(), status = 'active' } = {},
) {
  let mergeTarget
  if (status === 'merged') {
    mergeTarget = randomUUID()
    await client.query(
      `insert into public.app_users (id, status) values ($1, 'active')`,
      [mergeTarget],
    )
  }
  await client.query(
    `insert into public.app_users (
       id, status, disabled_at, merged_into_user_id
     ) values (
       $1::uuid,
       $2::public.app_user_status,
       case when $2 in ('suspended', 'merged') then clock_timestamp() else null end,
       $3::uuid
     )`,
    [userId, status, mergeTarget ?? null],
  )
  return userId
}

async function insertIdentity(
  client,
  {
    userId,
    issuer,
    subject,
    verified = true,
    revoked = false,
    lastUsed = false,
  },
) {
  await client.query(
    `with evidence_time as (select clock_timestamp() as at)
     insert into public.user_identities (
       user_id, provider, provider_tenant, provider_subject,
       verified_at, revoked_at, last_used_at
     )
     select $1::uuid,
            'supabase_auth'::public.identity_provider,
            $2::text,
            $3::text,
            case when $4::boolean then at else null end,
            case when $5::boolean then at else null end,
            case when $6::boolean then at else null end
       from evidence_time`,
    [userId, issuer, subject, verified, revoked, lastUsed],
  )
}

async function insertAuthUser(client, subject) {
  await client.query(
    `insert into auth.users (
       id, email, raw_user_meta_data, created_at, updated_at
     ) values ($1::uuid, $2::text, '{}'::jsonb, now(), now())`,
    [subject, `synthetic-${randomUUID()}@example.invalid`],
  )
}

async function createSourceFixture(
  client,
  {
    status = 'active',
    verified = true,
    revoked = false,
    includeAuthUser = true,
    subject = randomUUID(),
  } = {},
) {
  const userId = await insertAppUser(client, { status })
  await insertIdentity(client, {
    userId,
    issuer: sourceIssuer,
    subject,
    verified,
    revoked,
  })
  if (includeAuthUser) await insertAuthUser(client, subject)
  return { userId, subject }
}

async function withRolledBackTransaction(client, run) {
  await client.query('begin')
  try {
    await run()
  } finally {
    await client.query('rollback')
  }
}

async function expectCode(name, expectedCode, run) {
  try {
    await run()
    check(name, false)
  } catch (error) {
    check(
      name,
      error instanceof RecoveryRebindError && error.code === expectedCode,
    )
  }
}

async function identitySnapshot(client, issuer, subject) {
  const result = await client.query(
    `select id::text, user_id::text, provider::text, provider_tenant,
            provider_subject, verified_at, last_used_at, created_at,
            updated_at, revoked_at
       from public.user_identities
      where provider = 'supabase_auth'
        and provider_tenant = $1
        and provider_subject = $2`,
    [issuer, subject],
  )
  return result.rows
}

// Local, verifier-only helper: reproduce the exact JWT boundary the real
// Recovery drill exercised. It sets synthetic request.jwt.claims and calls the
// production boundary public.current_app_user_id(), returning only the resolved
// synthetic app_user id (or null). It mirrors the operator's existing
// currentAppUserForClaims behavior and is test/verifier-only: it does not
// create an RPC, migration, Edge endpoint, or any frontend surface.
//
// NOTE: set_config(..., true) is transaction-local, so this helper must be
// invoked inside an explicit transaction so the GUC survives the
// set_config -> select round-trip.
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

const status = localStatus()
requireLoopbackUrl(status.API_URL, ['http:', 'https:'])
requireLoopbackUrl(status.DB_URL, ['postgres:', 'postgresql:'])

const client = new Client({ connectionString: status.DB_URL })
await client.connect()

try {
  const evidence = await databaseEvidence(client)

  // Full happy path: PLAN -> separately reviewed APPLY -> repeat APPLY.
  const happy = await createSourceFixture(client)
  const happyInput = recoveryInput(evidence, happy.subject)
  const oldBefore = await identitySnapshot(client, sourceIssuer, happy.subject)

  // R3 acceptance regression: reproduce the exact current_app_user_id() JWT
  // boundary that failed during the real Recovery drill. Before the Recovery
  // tenant identity is appended:
  //   - a Recovery-style JWT (target issuer + restored subject) must NOT resolve
  //     through the production boundary public.current_app_user_id();
  //   - the existing source issuer + same subject must still resolve to the
  //     original app_user through the same boundary.
  let preRebindResolution
  await withRolledBackTransaction(client, async () => {
    const recoveryJwtUserId = await currentAppUserForClaims(
      client,
      targetIssuer,
      happy.subject,
    )
    const sourceJwtUserId = await currentAppUserForClaims(
      client,
      sourceIssuer,
      happy.subject,
    )
    preRebindResolution = { recoveryJwtUserId, sourceJwtUserId }
  })
  check(
    'before rebind the Recovery issuer and restored subject do not resolve through current_app_user_id()',
    preRebindResolution.recoveryJwtUserId === null,
  )
  check(
    'before rebind the source issuer and subject still resolve through current_app_user_id()',
    preRebindResolution.sourceJwtUserId === happy.userId,
  )

  const targetBefore = await client.query(
    'select public.resolve_app_user_id($1, $2, $3)::text as user_id',
    ['supabase_auth', targetIssuer, happy.subject],
  )
  check(
    'before rebind the Recovery issuer and restored subject do not resolve',
    targetBefore.rows[0]?.user_id === null,
  )

  const plan = await planRecoveryAuthTenantRebind(client, happyInput)
  check(
    'PLAN reports exactly one safe rebind and performs no mutation',
    plan.safe_rebind_count === 1 &&
      plan.idempotent_noop_count === 0 &&
      plan.mutation_performed === false,
  )
  check(
    'PLAN output contains only safe evidence fields',
    !JSON.stringify(plan).includes(happy.subject) &&
      !JSON.stringify(plan).includes(happy.userId) &&
      !JSON.stringify(plan).includes(sourceIssuer) &&
      !JSON.stringify(plan).includes(targetIssuer),
  )

  const apply = await applyRecoveryAuthTenantRebind(
    client,
    happyInput,
    plan.plan_digest,
  )
  check(
    'APPLY inserts exactly one target identity',
    apply.identities_inserted === 1 && apply.mutation_performed === true,
  )
  const oldAfter = await identitySnapshot(client, sourceIssuer, happy.subject)
  const newAfter = await identitySnapshot(client, targetIssuer, happy.subject)
  check(
    'the historical source identity remains byte-for-byte unchanged',
    JSON.stringify(oldAfter) === JSON.stringify(oldBefore),
  )
  check(
    'the appended target identity keeps the same app_user and no fabricated usage',
    newAfter.length === 1 &&
      newAfter[0]?.user_id === happy.userId &&
      newAfter[0]?.last_used_at === null,
  )
  check(
    'source and target exact issuer plus subject resolve to the same app_user',
    apply.source_resolution_preserved === true &&
      apply.target_resolution_verified === true,
  )

  // After APPLY, explicitly prove through the same production boundary that
  // both the source issuer and the newly rebound Recovery issuer + subject
  // resolve to the same existing app_user.
  let postRebindResolution
  await withRolledBackTransaction(client, async () => {
    const sourceAfter = await currentAppUserForClaims(
      client,
      sourceIssuer,
      happy.subject,
    )
    const targetAfter = await currentAppUserForClaims(
      client,
      targetIssuer,
      happy.subject,
    )
    postRebindResolution = { sourceAfter, targetAfter }
  })
  check(
    'after rebind the source issuer and subject resolve through current_app_user_id()',
    postRebindResolution.sourceAfter === happy.userId,
  )
  check(
    'after rebind the Recovery issuer and subject resolve through current_app_user_id() to the same app_user',
    postRebindResolution.targetAfter === happy.userId,
  )

  const repeatPlan = await planRecoveryAuthTenantRebind(client, happyInput)
  check(
    'repeat PLAN reports an idempotent no-op',
    repeatPlan.safe_rebind_count === 0 &&
      repeatPlan.idempotent_noop_count === 1 &&
      repeatPlan.plan_digest !== plan.plan_digest,
  )
  const repeatApply = await applyRecoveryAuthTenantRebind(
    client,
    happyInput,
    repeatPlan.plan_digest,
  )
  check(
    'repeat APPLY is an idempotent no-op without duplicates',
    repeatApply.identities_inserted === 0 &&
      repeatApply.idempotent_noop_count === 1 &&
      (await identitySnapshot(client, targetIssuer, happy.subject)).length ===
        1,
  )

  // A reviewed digest is bound to the exact identity and database evidence.
  const digestFixture = await createSourceFixture(client)
  const digestInput = recoveryInput(evidence, digestFixture.subject)
  await expectCode(
    'APPLY rejects an unreviewed or mismatched PLAN digest atomically',
    'reviewed_plan_mismatch',
    () => applyRecoveryAuthTenantRebind(client, digestInput, 'f'.repeat(64)),
  )
  check(
    'failed APPLY leaves no partial target binding',
    (await identitySnapshot(client, targetIssuer, digestFixture.subject))
      .length === 0,
  )

  await client.query('begin isolation level serializable')
  try {
    const fixture = await createSourceFixture(client)
    await insertIdentity(client, {
      userId: fixture.userId,
      issuer: targetIssuer,
      subject: fixture.subject,
      lastUsed: true,
    })
    const existingInput = recoveryInput(evidence, fixture.subject)
    const existingPlan = await inspectRecoveryAuthTenantRebind(
      client,
      existingInput,
    )
    const existingBefore = await identitySnapshot(
      client,
      targetIssuer,
      fixture.subject,
    )
    const existingApply = await applyRecoveryAuthTenantRebindInTransaction(
      client,
      existingInput,
      existingPlan.planDigest,
    )
    const existingAfter = await identitySnapshot(
      client,
      targetIssuer,
      fixture.subject,
    )
    check(
      'an existing same-app_user target with real usage history is an unchanged no-op',
      existingApply.identities_inserted === 0 &&
        JSON.stringify(existingAfter) === JSON.stringify(existingBefore),
    )
  } finally {
    await client.query('rollback')
  }

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client, { verified: false })
    await expectCode(
      'unverified source fails closed',
      'source_identity_unverified',
      () =>
        inspectRecoveryAuthTenantRebind(
          client,
          recoveryInput(evidence, fixture.subject),
        ),
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client, { revoked: true })
    await expectCode(
      'revoked source fails closed',
      'source_identity_revoked',
      () =>
        inspectRecoveryAuthTenantRebind(
          client,
          recoveryInput(evidence, fixture.subject),
        ),
    )
  })

  for (const statusName of ['suspended', 'merged']) {
    await withRolledBackTransaction(client, async () => {
      const fixture = await createSourceFixture(client, { status: statusName })
      await expectCode(
        `${statusName} app_user fails closed`,
        'source_app_user_inactive',
        () =>
          inspectRecoveryAuthTenantRebind(
            client,
            recoveryInput(evidence, fixture.subject),
          ),
      )
    })
  }

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client, {
      includeAuthUser: false,
    })
    await expectCode(
      'missing restored auth.users UUID fails closed',
      'recovery_auth_subject_missing',
      () =>
        inspectRecoveryAuthTenantRebind(
          client,
          recoveryInput(evidence, fixture.subject),
        ),
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client)
    const otherUserId = await insertAppUser(client)
    await insertIdentity(client, {
      userId: otherUserId,
      issuer: targetIssuer,
      subject: fixture.subject,
    })
    await expectCode(
      'target issuer and subject bound to another app_user fails closed',
      'target_identity_conflict',
      () =>
        inspectRecoveryAuthTenantRebind(
          client,
          recoveryInput(evidence, fixture.subject),
        ),
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client)
    const otherUserId = await insertAppUser(client)
    await insertIdentity(client, {
      userId: otherUserId,
      issuer: thirdIssuer,
      subject: fixture.subject,
    })
    await expectCode(
      'one subject with multiple live app_user owners fails closed',
      'subject_ownership_ambiguous',
      () =>
        inspectRecoveryAuthTenantRebind(
          client,
          recoveryInput(evidence, fixture.subject),
        ),
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client)
    const wrongEvidence = {
      ...recoveryInput(evidence, fixture.subject),
      expectedSystemIdentifier: '9999999999999999999',
    }
    await expectCode(
      'wrong Recovery database evidence fails closed',
      'recovery_database_target_unproven',
      () => inspectRecoveryAuthTenantRebind(client, wrongEvidence),
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client)
    await client.query('set local role authenticated')
    let state
    try {
      await client.query(
        `insert into public.user_identities (
           user_id, provider, provider_tenant, provider_subject, verified_at
         ) values ($1, 'supabase_auth', $2, $3, now())`,
        [fixture.userId, targetIssuer, fixture.subject],
      )
    } catch (error) {
      state = error.code
    }
    check(
      'normal authenticated browser role cannot append a recovery identity',
      state === '42501',
    )
  })

  await withRolledBackTransaction(client, async () => {
    const fixture = await createSourceFixture(client)
    await client.query('set local role anon')
    let state
    try {
      await client.query(
        `insert into public.user_identities (
           user_id, provider, provider_tenant, provider_subject, verified_at
         ) values ($1, 'supabase_auth', $2, $3, now())`,
        [fixture.userId, targetIssuer, fixture.subject],
      )
    } catch (error) {
      state = error.code
    }
    check('anon cannot append a recovery identity', state === '42501')
  })

  const surfaces = await client.query(
    `select count(*)::int as recovery_surface_count
       from pg_proc as p
       join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'api')
        and p.proname like '%recovery%rebind%'`,
  )
  check(
    'no public RPC or database recovery endpoint exists',
    surfaces.rows[0]?.recovery_surface_count === 0,
  )

  const immutableTrigger = await client.query(
    `select count(*)::int as trigger_count
       from pg_trigger
      where tgrelid = 'public.user_identities'::regclass
        and tgname = 'user_identities_immutable'
        and not tgisinternal`,
  )
  check(
    'identity UPDATE and DELETE immutability trigger remains present',
    immutableTrigger.rows[0]?.trigger_count === 1,
  )
} finally {
  await client.end()
}

console.log('')
console.log(`recovery tenant rebind checks: ${checkCount}`)
if (failures.length > 0) {
  console.error(
    `RECOVERY TENANT REBIND FAILED: ${failures.length} check(s) failed`,
  )
  process.exit(1)
}
console.log(
  'RECOVERY TENANT REBIND PASSED: offline PLAN/APPLY invariants verified.',
)
