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
 * Every concurrent scenario uses genuine row-lock contention: the first
 * transaction acquires and holds its locks (project row, app_users row, or
 * workspace_members row) until it commits, while the second transaction
 * blocks on the very same rows. A dedicated observer connection polls
 * `pg_blocking_pids()` and confirms that the second backend is *actually*
 * blocked by the first backend before the first is allowed to commit. The
 * test fails if no real blocking is observed within a short deadline, so the
 * serialization order is proven by PostgreSQL's own lock graph rather than by
 * a fixed millisecond sleep.
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

const BLOCKING_DEADLINE_MS = 6000
const SLEEP_STEP_MS = 25

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Genuine-lock race with explicit PostgreSQL blocking proof.
//
// Both business connections open a transaction. We record each backend PID,
// run the first statement so it holds its row locks, then launch the second
// statement and bind its rejection handler *immediately* (the handler owns the
// rejection from creation, so it never becomes an unhandled rejection). A
// third observer connection polls `pg_blocking_pids($2)` and only after it
// confirms the second backend is blocked by the first backend do we commit the
// first transaction. If no real blocking is observed within the deadline the
// scenario is recorded as failed (and the first transaction is still committed
// to release the lock so the second can finish and the run does not hang). All
// transactions are closed/rolled back in `finally`.
//
// Local `lock_timeout` / `statement_timeout` are set as a CI safety net so a
// pathological lock never hangs the pipeline.
async function lockWaitRace({
  firstRole,
  firstActor,
  firstSql,
  firstParams,
  firstVerifySql,
  firstVerifyParams,
  secondRole,
  secondActor,
  secondSql,
  secondParams,
}) {
  const first = await connect()
  const second = await connect()
  const observer = await connect()
  let secondError = null
  let blockedObserved = false
  let firstResult
  let firstVerify
  try {
    if (firstRole === 'auth') await beginActor(first, firstActor)
    else await first.query('begin')
    if (secondRole === 'auth') await beginActor(second, secondActor)
    else await second.query('begin')
    // Safety nets so a CI never hangs if a lock is unexpectedly never released.
    await first.query("set local statement_timeout = '30s'")
    await second.query("set local lock_timeout = '20s'")
    await second.query("set local statement_timeout = '30s'")

    const firstPid = (await first.query('select pg_backend_pid() as pid'))
      .rows[0].pid
    const secondPid = (await second.query('select pg_backend_pid() as pid'))
      .rows[0].pid

    firstResult = await first.query(firstSql, firstParams)
    if (firstVerifySql) {
      firstVerify = await first.query(firstVerifySql, firstVerifyParams)
    }

    // Launch the second statement and bind its rejection handler at creation.
    const secondPending = second.query(secondSql, secondParams)
    secondPending.catch((error) => {
      secondError = error
    })

    const deadline = Date.now() + BLOCKING_DEADLINE_MS
    while (Date.now() < deadline) {
      const probe = await observer.query(
        'select $1 = any(pg_blocking_pids($2)) as blocked',
        [firstPid, secondPid],
      )
      if (probe.rows[0]?.blocked) {
        blockedObserved = true
        break
      }
      await sleep(SLEEP_STEP_MS)
    }

    if (!blockedObserved) {
      // Release the first transaction so the second can complete; the missing
      // blocking observation is reported as a failed check below.
      await first.query('commit')
    } else {
      await first.query('commit')
    }

    try {
      await secondPending
    } catch {
      // Already captured by the bound handler above.
    }
    if (secondError) {
      await rollbackQuietly(second)
    } else {
      await second.query('commit')
    }

    return { firstResult, firstVerify, secondError, blockedObserved }
  } finally {
    await rollbackQuietly(first)
    await rollbackQuietly(second)
    await rollbackQuietly(observer)
    await first.end()
    await second.end()
    await observer.end()
  }
}

const ids = {
  owner: crypto.randomUUID(),
  candidateA: crypto.randomUUID(),
  candidateB: crypto.randomUUID(),
  candidateC: crypto.randomUUID(),
  candidateD: crypto.randomUUID(),
  ordinary: crypto.randomUUID(),
  adminWriteFirst: crypto.randomUUID(),
  adminDemoteFirst: crypto.randomUUID(),
  ordinaryWrite: crypto.randomUUID(),
  ordinaryDemote: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  ownerRaceProject: crypto.randomUUID(),
  leadRaceProject: crypto.randomUUID(),
  removeRaceProject: crypto.randomUUID(),
  tLeadProject: crypto.randomUUID(),
  tOwnerProject: crypto.randomUUID(),
  tOwnerProject2: crypto.randomUUID(),
  tAdminProjectWrite: crypto.randomUUID(),
  tAdminProjectDemote: crypto.randomUUID(),
}
const subjects = {
  owner: `membership-concurrency-owner-${crypto.randomUUID()}`,
  candidateA: `membership-concurrency-a-${crypto.randomUUID()}`,
  candidateB: `membership-concurrency-b-${crypto.randomUUID()}`,
  candidateC: `membership-concurrency-c-${crypto.randomUUID()}`,
  candidateD: `membership-concurrency-d-${crypto.randomUUID()}`,
  ordinary: `membership-concurrency-member-${crypto.randomUUID()}`,
  adminWriteFirst: `membership-concurrency-admin-write-${crypto.randomUUID()}`,
  adminDemoteFirst: `membership-concurrency-admin-demote-${crypto.randomUUID()}`,
  ordinaryWrite: `membership-concurrency-ordinary-write-${crypto.randomUUID()}`,
  ordinaryDemote: `membership-concurrency-ordinary-demote-${crypto.randomUUID()}`,
}

const users = {
  owner: ids.owner,
  candidateA: ids.candidateA,
  candidateB: ids.candidateB,
  candidateC: ids.candidateC,
  candidateD: ids.candidateD,
  ordinary: ids.ordinary,
  adminWriteFirst: ids.adminWriteFirst,
  adminDemoteFirst: ids.adminDemoteFirst,
  ordinaryWrite: ids.ordinaryWrite,
  ordinaryDemote: ids.ordinaryDemote,
}
const workspaceRoles = {
  [ids.owner]: 'owner',
  [ids.adminWriteFirst]: 'admin',
  [ids.adminDemoteFirst]: 'admin',
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
    ids.tAdminProjectWrite,
    ids.tAdminProjectDemote,
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

const ownerRace = await lockWaitRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  firstParams: [ids.ownerRaceProject, ids.candidateA, ownerVersion],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql: 'select changed from public.transfer_project_owner($1, $2, $3)',
  secondParams: [ids.ownerRaceProject, ids.candidateB, ownerVersion],
})
check(
  'owner transfer stale race: first concurrent transfer succeeds',
  ownerRace.firstResult.rows[0]?.changed === true,
)
check(
  'owner transfer stale race: second transfer deterministically fails stale',
  ownerRace.secondError?.code === '40001',
)
check(
  'owner transfer stale race: second transaction observed blocked on the project row',
  ownerRace.blockedObserved === true,
)

const leadRace = await lockWaitRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql: 'select changed from public.set_project_lead($1, $2, $3)',
  firstParams: [ids.leadRaceProject, ids.candidateA, leadVersion],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql: 'select changed from public.set_project_lead($1, $2, $3)',
  secondParams: [ids.leadRaceProject, ids.candidateB, leadVersion],
})
check(
  'lead assignment stale race: first concurrent lead assignment succeeds',
  leadRace.firstResult.rows[0]?.changed === true,
)
check(
  'lead assignment stale race: second assignment deterministically fails stale',
  leadRace.secondError?.code === '40001',
)
check(
  'lead assignment stale race: second transaction observed blocked on the project row',
  leadRace.blockedObserved === true,
)

const removeRace = await lockWaitRace({
  firstRole: 'auth',
  firstActor: subjects.owner,
  firstSql: 'select changed from public.remove_project_member($1, $2)',
  firstParams: [ids.removeRaceProject, ids.ordinary],
  secondRole: 'auth',
  secondActor: subjects.owner,
  secondSql:
    "select changed from public.set_project_member_role($1, $2, 'viewer')",
  secondParams: [ids.removeRaceProject, ids.ordinary],
})
check(
  'remove-vs-role stale race: concurrent removal succeeds',
  removeRace.firstResult.rows[0]?.changed === true,
)
check(
  'remove-vs-role stale race: blocked role change observes committed removal',
  removeRace.secondError?.code === 'P0002',
)
check(
  'remove-vs-role stale race: second transaction observed blocked on the project row',
  removeRace.blockedObserved === true,
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
    'all stale-raced projects retain exactly one aligned owner',
    invariants.rows.every(
      (row) => Number(row.owners) === 1 && row.owner_aligned === true,
    ),
  )
  check(
    'all stale-raced projects retain at most one aligned lead',
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
const leadApptFirst = await lockWaitRace({
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
check(
  '7.1 appointment-first: second transaction observed blocked on the candidate lock',
  leadApptFirst.blockedObserved === true,
)

const leadSuspendFirst = await lockWaitRace({
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
check(
  '7.1 suspension-first: second transaction observed blocked on the candidate lock',
  leadSuspendFirst.blockedObserved === true,
)

// ---------------------------------------------------------------------------
// 7.2 Owner transfer vs app-user suspension (both orders).
// The two operations contend on the target's app_users row lock. candidateC and
// candidateD are plain workspace members with no project responsibility, so
// suspension is always permitted before any transfer.
// ---------------------------------------------------------------------------
const ownerTransferFirst = await lockWaitRace({
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
check(
  '7.2 transfer-first: second transaction observed blocked on the target lock',
  ownerTransferFirst.blockedObserved === true,
)

const ownerSuspendFirst = await lockWaitRace({
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
check(
  '7.2 suspension-first: second transaction observed blocked on the target lock',
  ownerSuspendFirst.blockedObserved === true,
)

// ---------------------------------------------------------------------------
// 7.3 Workspace admin revocation vs ordinary member write (both orders).
//
// Two fully independent scenarios. Each uses its own admin actor, its own
// project, and its own ordinary target member; neither actor is an
// owner/lead. The two operations contend on the actor's workspace_members row
// lock. We explicitly pre-check that each actor starts as an active workspace
// admin, prove the real blocking via pg_blocking_pids, and assert the expected
// final actor role plus whether the target member relation was (or was not)
// written.
// ---------------------------------------------------------------------------

const writeFirstPre = await connect()
try {
  const row = (
    await writeFirstPre.query(
      'select role, status from public.workspace_members where workspace_id = $1 and user_id = $2',
      [ids.workspace, ids.adminWriteFirst],
    )
  ).rows[0]
  check(
    '7.3 write-first: actor is an active workspace admin before the race',
    row?.role === 'admin' && row?.status === 'active',
  )
} finally {
  await writeFirstPre.end()
}

const demoteFirstPre = await connect()
try {
  const row = (
    await demoteFirstPre.query(
      'select role, status from public.workspace_members where workspace_id = $1 and user_id = $2',
      [ids.workspace, ids.adminDemoteFirst],
    )
  ).rows[0]
  check(
    '7.3 demotion-first: actor is an active workspace admin before the race',
    row?.role === 'admin' && row?.status === 'active',
  )
} finally {
  await demoteFirstPre.end()
}

const adminWriteFirstRace = await lockWaitRace({
  firstRole: 'auth',
  firstActor: subjects.adminWriteFirst,
  firstSql: 'select changed from public.add_project_member($1, $2, $3)',
  firstParams: [ids.tAdminProjectWrite, ids.ordinaryWrite, 'member'],
  secondRole: 'plain',
  secondSql:
    'update public.workspace_members set role = $2 where workspace_id = $1 and user_id = $3',
  secondParams: [ids.workspace, 'member', ids.adminWriteFirst],
})
check(
  '7.3 write-first: admin member write commits while holding the actor lock',
  adminWriteFirstRace.firstResult.rows[0]?.changed === true,
)
check(
  '7.3 write-first: later admin demotion is applied (no lock conflict)',
  adminWriteFirstRace.secondError === null,
)
check(
  '7.3 write-first: second transaction observed blocked on the actor lock',
  adminWriteFirstRace.blockedObserved === true,
)

const adminDemoteFirstRace = await lockWaitRace({
  firstRole: 'plain',
  firstSql:
    'update public.workspace_members set role = $2 where workspace_id = $1 and user_id = $3',
  firstParams: [ids.workspace, 'member', ids.adminDemoteFirst],
  secondRole: 'auth',
  secondActor: subjects.adminDemoteFirst,
  secondSql: 'select changed from public.add_project_member($1, $2, $3)',
  secondParams: [ids.tAdminProjectDemote, ids.ordinaryDemote, 'member'],
})
check(
  '7.3 demotion-first: admin demotion commits while holding the actor lock',
  adminDemoteFirstRace.firstResult.rowCount === 1,
)
check(
  '7.3 demotion-first: member write is rejected because the actor is no longer an admin',
  adminDemoteFirstRace.secondError?.code === '42501',
)
check(
  '7.3 demotion-first: second transaction observed blocked on the actor lock',
  adminDemoteFirstRace.blockedObserved === true,
)

// Post-race assertions: the demotion-first target was never inserted (the RPC
// returned 42501 before any insert), and both actors were demoted to member.
const race7_3 = await connect()
try {
  const demoteMember = (
    await race7_3.query(
      'select count(*)::int as count from public.project_members where project_id = $1 and user_id = $2',
      [ids.tAdminProjectDemote, ids.ordinaryDemote],
    )
  ).rows[0].count
  const writeMember = (
    await race7_3.query(
      'select count(*)::int as count from public.project_members where project_id = $1 and user_id = $2',
      [ids.tAdminProjectWrite, ids.ordinaryWrite],
    )
  ).rows[0].count
  const writeActorRole = (
    await race7_3.query(
      'select role from public.workspace_members where workspace_id = $1 and user_id = $2',
      [ids.workspace, ids.adminWriteFirst],
    )
  ).rows[0].role
  const demoteActorRole = (
    await race7_3.query(
      'select role from public.workspace_members where workspace_id = $1 and user_id = $2',
      [ids.workspace, ids.adminDemoteFirst],
    )
  ).rows[0].role
  check(
    '7.3 demotion-first: target member relation was NOT created',
    demoteMember === 0,
  )
  check(
    '7.3 write-first: target member relation WAS created',
    writeMember === 1,
  )
  check(
    '7.3 write-first: actor was demoted to member',
    writeActorRole === 'member',
  )
  check(
    '7.3 demotion-first: actor was demoted to member',
    demoteActorRole === 'member',
  )
} finally {
  await race7_3.end()
}

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
        ids.tAdminProjectWrite,
        ids.tAdminProjectDemote,
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
