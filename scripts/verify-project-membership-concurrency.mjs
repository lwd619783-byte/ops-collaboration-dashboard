#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 2.2 real PostgreSQL concurrency verifier.
 *
 * Runs only against `supabase status --local` and uses fictional, random
 * fixture identifiers. It launches separate authenticated database sessions
 * so project row locks, optimistic versions and transaction rollback are
 * exercised by PostgreSQL rather than mocked in JavaScript.
 *
 * The new 7.x scenarios use genuine row-lock contention (one transaction
 * acquires and holds the lock, the other blocks until it commits) instead of
 * fixed millisecond sleeps, proving the serialization order is linearizable.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const requireFromRepo = createRequire(join(repoRoot, 'package.json'))
const { Client } = requireFromRepo('pg')

function localStatus() {
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'supabase', 'dist', 'supabase.js'),
      'status',
      '-o',
      'json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    },
  )
  if (result.status !== 0) {
    throw new Error('Local Supabase status is unavailable.')
  }
  return JSON.parse(result.stdout)
}

const status = localStatus()
const dbUrl = status.DB_URL
const issuer = `${status.API_URL}/auth/v1`
const checks = []

function check(name, condition) {
  checks.push({ name, condition })
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${name}`)
}

async function connect() {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  return client
}

async function beginActor(client, subject) {
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: subject, iss: issuer, role: 'authenticated' }),
  ])
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback')
  } catch {
    // The verification result is already captured; cleanup is best effort.
  }
}

// Stale-version race: two writers contend on the project row lock; the second
// observes the committed outcome of the first (stale version or removed row).
async function concurrentStaleRace({
  firstSql,
  firstParams,
  secondSql,
  secondParams,
  subject,
}) {
  const first = await connect()
  const second = await connect()
  try {
    await beginActor(first, subject)
    await beginActor(second, subject)
    const firstResult = await first.query(firstSql, firstParams)
    const secondPending = second.query(secondSql, secondParams)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await first.query('commit')
    let secondError = null
    try {
      await secondPending
      await second.query('commit')
    } catch (error) {
      secondError = error
      await rollbackQuietly(second)
    }
    return { firstResult, secondError }
  } finally {
    await rollbackQuietly(first)
    await rollbackQuietly(second)
    await first.end()
    await second.end()
  }
}

// Real-lock race: `first` acquires and holds its row locks until commit, while
// `second` blocks on the same rows. Committing `first` releases the lock so
// `second` proceeds. firstRole/secondRole pick authenticated (JWT) or plain
// (postgres, used for direct status/role changes) execution. No fixed sleeps.
async function realLockRace({
  firstRole,
  firstActor,
  firstSql,
  firstParams,
  secondRole,
  secondActor,
  secondSql,
  secondParams,
}) {
  const first = await connect()
  const second = await connect()
  try {
    if (firstRole === 'auth') await beginActor(first, firstActor)
    else await first.query('begin')
    if (secondRole === 'auth') await beginActor(second, secondActor)
    else await second.query('begin')
    const firstResult = await first.query(firstSql, firstParams)
    let secondError = null
    // Capture (do not re-throw) at creation so the rejection is owned here and
    // never surfaces as an unhandled rejection before the await below runs.
    const secondPending = second
      .query(secondSql, secondParams)
      .catch((error) => {
        secondError = error
      })
    await first.query('commit')
    try {
      await secondPending
      if (!secondError) await second.query('commit')
    } catch (error) {
      secondError = error
      await rollbackQuietly(second)
    }
    return { firstResult, secondError }
  } finally {
    await rollbackQuietly(first)
    await rollbackQuietly(second)
    await first.end()
    await second.end()
  }
}

const ids = {
  owner: crypto.randomUUID(),
  candidateA: crypto.randomUUID(),
  candidateB: crypto.randomUUID(),
  candidateC: crypto.randomUUID(),
  candidateD: crypto.randomUUID(),
  ordinary: crypto.randomUUID(),
  adminUser: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  ownerRaceProject: crypto.randomUUID(),
  leadRaceProject: crypto.randomUUID(),
  removeRaceProject: crypto.randomUUID(),
  tLeadProject: crypto.randomUUID(),
  tOwnerProject: crypto.randomUUID(),
  tOwnerProject2: crypto.randomUUID(),
  tAdminProject: crypto.randomUUID(),
}
const subjects = {
  owner: `membership-concurrency-owner-${crypto.randomUUID()}`,
  candidateA: `membership-concurrency-a-${crypto.randomUUID()}`,
  candidateB: `membership-concurrency-b-${crypto.randomUUID()}`,
  candidateC: `membership-concurrency-c-${crypto.randomUUID()}`,
  candidateD: `membership-concurrency-d-${crypto.randomUUID()}`,
  ordinary: `membership-concurrency-member-${crypto.randomUUID()}`,
  adminUser: `membership-concurrency-admin-${crypto.randomUUID()}`,
}

const users = {
  owner: ids.owner,
  candidateA: ids.candidateA,
  candidateB: ids.candidateB,
  candidateC: ids.candidateC,
  candidateD: ids.candidateD,
  ordinary: ids.ordinary,
  adminUser: ids.adminUser,
}
const workspaceRoles = {
  [ids.owner]: 'owner',
  [ids.adminUser]: 'admin',
}

const setup = await connect()
try {
  await setup.query('begin')
  for (const userId of Object.values(users)) {
    await setup.query(
      `insert into public.app_users (id, status) values ($1, 'active')`,
      [userId],
    )
    await setup.query(
      `insert into public.profiles (user_id, display_name) values ($1, $2)`,
      [userId, `Fictional concurrency ${userId.slice(0, 8)}`],
    )
    await setup.query(
      `insert into public.user_identities
         (user_id, provider, provider_tenant, provider_subject, verified_at)
       values ($1, 'supabase_auth', $2, $3, now())`,
      [
        userId,
        issuer,
        subjects[Object.keys(users).find((k) => users[k] === userId)],
      ],
    )
  }
  await setup.query(
    `insert into public.workspaces (id, name, owner_id, created_by)
     values ($1, 'Fictional membership concurrency workspace', $2, $2)`,
    [ids.workspace, ids.owner],
  )
  for (const userId of Object.values(users)) {
    await setup.query(
      `insert into public.workspace_members
         (workspace_id, user_id, role, status, invited_by, joined_at)
       values ($1, $2, $3, 'active', $4, now())`,
      [ids.workspace, userId, workspaceRoles[userId] ?? 'member', ids.owner],
    )
  }
  for (const projectId of [
    ids.ownerRaceProject,
    ids.leadRaceProject,
    ids.removeRaceProject,
    ids.tLeadProject,
    ids.tOwnerProject,
    ids.tOwnerProject2,
    ids.tAdminProject,
  ]) {
    await setup.query(
      `insert into public.projects
         (id, workspace_id, name, status, owner_id, created_by, idempotency_key)
       values ($1, $2, $3, 'active', $4, $4, $5)`,
      [
        projectId,
        ids.workspace,
        `Fictional concurrency project ${projectId.slice(0, 8)}`,
        ids.owner,
        crypto.randomUUID(),
      ],
    )
    await setup.query(
      `insert into public.project_members (project_id, user_id, role)
       values ($1, $2, 'owner')`,
      [projectId, ids.owner],
    )
  }
  await setup.query(
    `insert into public.project_members (project_id, user_id, role)
     values ($1, $2, 'member')`,
    [ids.removeRaceProject, ids.ordinary],
  )
  await setup.query('commit')
} catch (error) {
  await rollbackQuietly(setup)
  throw error
} finally {
  await setup.end()
}

const read = await connect()
let ownerVersion
let leadVersion
let tLeadVersion
let tOwnerVersion
let tOwner2Version
try {
  ownerVersion = (
    await read.query(
      'select updated_at::text as updated_at from public.projects where id = $1',
      [ids.ownerRaceProject],
    )
  ).rows[0].updated_at
  leadVersion = (
    await read.query(
      'select updated_at::text as updated_at from public.projects where id = $1',
      [ids.leadRaceProject],
    )
  ).rows[0].updated_at
  tLeadVersion = (
    await read.query(
      'select updated_at::text as updated_at from public.projects where id = $1',
      [ids.tLeadProject],
    )
  ).rows[0].updated_at
  tOwnerVersion = (
    await read.query(
      'select updated_at::text as updated_at from public.projects where id = $1',
      [ids.tOwnerProject],
    )
  ).rows[0].updated_at
  tOwner2Version = (
    await read.query(
      'select updated_at::text as updated_at from public.projects where id = $1',
      [ids.tOwnerProject2],
    )
  ).rows[0].updated_at
} finally {
  await read.end()
}

console.log('Project membership concurrency verification')

const ownerRace = await concurrentStaleRace({
  subject: subjects.owner,
  firstSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  firstParams: [ids.ownerRaceProject, ids.candidateA, ownerVersion],
  secondSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  secondParams: [ids.ownerRaceProject, ids.candidateB, ownerVersion],
})
check(
  'first concurrent owner transfer succeeds',
  ownerRace.firstResult.rows[0]?.changed === true,
)
check(
  'second owner transfer deterministically fails stale',
  ownerRace.secondError?.code === '40001',
)

const leadRace = await concurrentStaleRace({
  subject: subjects.owner,
  firstSql: 'select changed from public.set_project_lead($1, $2, $3)',
  firstParams: [ids.leadRaceProject, ids.candidateA, leadVersion],
  secondSql: 'select changed from public.set_project_lead($1, $2, $3)',
  secondParams: [ids.leadRaceProject, ids.candidateB, leadVersion],
})
check(
  'first concurrent lead assignment succeeds',
  leadRace.firstResult.rows[0]?.changed === true,
)
check(
  'second lead assignment deterministically fails stale',
  leadRace.secondError?.code === '40001',
)

const removeRace = await concurrentStaleRace({
  subject: subjects.owner,
  firstSql: 'select changed from public.remove_project_member($1, $2)',
  firstParams: [ids.removeRaceProject, ids.ordinary],
  secondSql:
    "select changed from public.set_project_member_role($1, $2, 'viewer')",
  secondParams: [ids.removeRaceProject, ids.ordinary],
})
check(
  'concurrent removal succeeds',
  removeRace.firstResult.rows[0]?.changed === true,
)
check(
  'blocked role change observes committed removal',
  removeRace.secondError?.code === 'P0002',
)

const verify = await connect()
try {
  const invariants = await verify.query(
    `select p.id,
       count(*) filter (where pm.role = 'owner') as owners,
       count(*) filter (where pm.role = 'lead') as leads,
       bool_and((pm.role = 'owner') = (pm.user_id = p.owner_id)) as owner_aligned,
       bool_and((pm.role = 'lead') = (pm.user_id is not distinct from p.lead_id)) as lead_aligned
     from public.projects p
     join public.project_members pm on pm.project_id = p.id
     where p.id = any($1::uuid[])
     group by p.id`,
    [[ids.ownerRaceProject, ids.leadRaceProject, ids.removeRaceProject]],
  )
  check(
    'all raced projects retain exactly one aligned owner',
    invariants.rows.every(
      (row) => Number(row.owners) === 1 && row.owner_aligned === true,
    ),
  )
  check(
    'all raced projects retain at most one aligned lead',
    invariants.rows.every(
      (row) => Number(row.leads) <= 1 && row.lead_aligned === true,
    ),
  )
  const removed = await verify.query(
    'select count(*)::int as count from public.project_members where project_id = $1 and user_id = $2',
    [ids.removeRaceProject, ids.ordinary],
  )
  check(
    'remove-vs-role race leaves no partial member row',
    removed.rows[0]?.count === 0,
  )
} finally {
  await verify.end()
}

// ---------------------------------------------------------------------------
// 7.1 Lead appointment vs workspace membership suspension (both orders).
// The two operations contend on the candidate's workspace_members row lock.
// ---------------------------------------------------------------------------
const leadApptFirst = await realLockRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql: 'select changed from public.set_project_lead($1, $2, $3)',
  firstParams: [ids.tLeadProject, ids.candidateA, tLeadVersion],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql:
    'select status::text from public.set_workspace_member_status($1, $2, $3)',
  secondParams: [ids.workspace, ids.candidateA, 'suspended'],
})
check(
  '7.1 appointment-first: lead appointment commits',
  leadApptFirst.firstResult.rows[0]?.changed === true,
)
check(
  '7.1 appointment-first: later workspace suspension is blocked because the candidate became an active lead',
  leadApptFirst.secondError?.code === '55000',
)

const leadSuspendFirst = await realLockRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql:
    'select status::text from public.set_workspace_member_status($1, $2, $3)',
  firstParams: [ids.workspace, ids.candidateB, 'suspended'],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql: 'select changed from public.set_project_lead($1, $2, $3)',
  secondParams: [ids.tLeadProject, ids.candidateB, tLeadVersion],
})
check(
  '7.1 suspension-first: workspace suspension commits',
  leadSuspendFirst.firstResult.rows[0]?.status === 'suspended',
)
check(
  '7.1 suspension-first: lead appointment is rejected because the candidate is suspended',
  leadSuspendFirst.secondError?.code === '22023',
)

// ---------------------------------------------------------------------------
// 7.2 Owner transfer vs app-user suspension (both orders).
// The two operations contend on the target's app_users row lock. candidateC is
// a plain workspace member with no project responsibility, so suspension is
// always permitted before any transfer.
// ---------------------------------------------------------------------------
const ownerTransferFirst = await realLockRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  firstParams: [ids.tOwnerProject, ids.candidateC, tOwnerVersion],
  secondRole: 'plain',
  secondSql:
    'update public.app_users set status = $2, disabled_at = now() where id = $1',
  secondParams: [ids.candidateC, 'suspended'],
})
check(
  '7.2 transfer-first: owner transfer commits',
  ownerTransferFirst.firstResult.rows[0]?.changed === true,
)
check(
  '7.2 transfer-first: later app-user suspension is blocked because the target became an active owner',
  ownerTransferFirst.secondError?.code === '55000',
)

const ownerSuspendFirst = await realLockRace({
  firstRole: 'plain',
  firstSql:
    'update public.app_users set status = $2, disabled_at = now() where id = $1',
  firstParams: [ids.candidateD, 'suspended'],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  secondParams: [ids.tOwnerProject2, ids.candidateD, tOwner2Version],
})
check(
  '7.2 suspension-first: app-user suspension commits',
  ownerSuspendFirst.firstResult.rowCount === 1,
)
check(
  '7.2 suspension-first: owner transfer is rejected because the target is suspended',
  ownerSuspendFirst.secondError?.code === '22023',
)

// ---------------------------------------------------------------------------
// 7.3 Workspace admin revocation vs ordinary member write (both orders).
// The two operations contend on the admin's workspace_members row lock.
// ---------------------------------------------------------------------------
const adminWriteFirst = await realLockRace({
  firstRole: 'auth',
  firstActor: subjects.adminUser,
  firstSql: 'select changed from public.add_project_member($1, $2, $3)',
  firstParams: [ids.tAdminProject, ids.ordinary, 'member'],
  secondRole: 'plain',
  secondSql:
    'update public.workspace_members set role = $2 where workspace_id = $1 and user_id = $3',
  secondParams: [ids.workspace, 'member', ids.adminUser],
})
check(
  '7.3 write-first: admin member write commits',
  adminWriteFirst.firstResult.rows[0]?.changed === true,
)
check(
  '7.3 write-first: later admin demotion is applied (no lock conflict)',
  adminWriteFirst.secondError === null,
)

const adminDemoteFirst = await realLockRace({
  firstRole: 'plain',
  firstSql:
    'update public.workspace_members set role = $2 where workspace_id = $1 and user_id = $3',
  firstParams: [ids.workspace, 'member', ids.adminUser],
  secondRole: 'auth',
  secondActor: subjects.adminUser,
  secondSql: 'select changed from public.add_project_member($1, $2, $3)',
  secondParams: [ids.tAdminProject, ids.ordinary, 'member'],
})
check(
  '7.3 demotion-first: admin demotion commits',
  adminDemoteFirst.firstResult.rowCount === 1,
)
check(
  '7.3 demotion-first: member write is rejected because the actor is no longer an admin',
  adminDemoteFirst.secondError?.code === '42501',
)

const raceInvariants = await connect()
try {
  const rows = await raceInvariants.query(
    `select p.id,
       count(*) filter (where pm.role = 'owner') as owners,
       count(*) filter (where pm.role = 'lead') as leads
     from public.projects p
     join public.project_members pm on pm.project_id = p.id
     where p.id = any($1::uuid[])
     group by p.id`,
    [
      [
        ids.tLeadProject,
        ids.tOwnerProject,
        ids.tOwnerProject2,
        ids.tAdminProject,
      ],
    ],
  )
  check(
    '7.x raced projects retain exactly one owner',
    rows.rows.every((row) => Number(row.owners) === 1),
  )
  check(
    '7.x raced projects retain at most one lead',
    rows.rows.every((row) => Number(row.leads) <= 1),
  )
} finally {
  await raceInvariants.end()
}

if (checks.some((item) => !item.condition)) {
  process.exitCode = 1
} else {
  console.log(
    `Project membership concurrency verification passed (${checks.length} checks).`,
  )
}
