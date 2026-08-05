#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 2.2 real PostgreSQL concurrency verifier.
 *
 * Runs only against `supabase status --local` and uses fictional, random
 * fixture identifiers. It launches separate authenticated database sessions
 * so project row locks, optimistic versions and transaction rollback are
 * exercised by PostgreSQL rather than mocked in JavaScript.
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

const ids = {
  owner: crypto.randomUUID(),
  candidateA: crypto.randomUUID(),
  candidateB: crypto.randomUUID(),
  ordinary: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  ownerRaceProject: crypto.randomUUID(),
  leadRaceProject: crypto.randomUUID(),
  removeRaceProject: crypto.randomUUID(),
}
const subjects = {
  owner: `membership-concurrency-owner-${crypto.randomUUID()}`,
  candidateA: `membership-concurrency-a-${crypto.randomUUID()}`,
  candidateB: `membership-concurrency-b-${crypto.randomUUID()}`,
  ordinary: `membership-concurrency-member-${crypto.randomUUID()}`,
}

const setup = await connect()
try {
  await setup.query('begin')
  for (const [name, userId] of Object.entries({
    owner: ids.owner,
    candidateA: ids.candidateA,
    candidateB: ids.candidateB,
    ordinary: ids.ordinary,
  })) {
    await setup.query(
      `insert into public.app_users (id, status) values ($1, 'active')`,
      [userId],
    )
    await setup.query(
      `insert into public.profiles (user_id, display_name) values ($1, $2)`,
      [userId, `Fictional concurrency ${name}`],
    )
    await setup.query(
      `insert into public.user_identities
         (user_id, provider, provider_tenant, provider_subject, verified_at)
       values ($1, 'supabase_auth', $2, $3, now())`,
      [userId, issuer, subjects[name]],
    )
  }
  await setup.query(
    `insert into public.workspaces (id, name, owner_id, created_by)
     values ($1, 'Fictional membership concurrency workspace', $2, $2)`,
    [ids.workspace, ids.owner],
  )
  for (const userId of [
    ids.owner,
    ids.candidateA,
    ids.candidateB,
    ids.ordinary,
  ]) {
    await setup.query(
      `insert into public.workspace_members
         (workspace_id, user_id, role, status, invited_by, joined_at)
       values ($1, $2, $3, 'active', $4, now())`,
      [
        ids.workspace,
        userId,
        userId === ids.owner ? 'owner' : 'member',
        ids.owner,
      ],
    )
  }
  for (const [name, projectId] of Object.entries({
    owner: ids.ownerRaceProject,
    lead: ids.leadRaceProject,
    remove: ids.removeRaceProject,
  })) {
    await setup.query(
      `insert into public.projects
         (id, workspace_id, name, status, owner_id, created_by, idempotency_key)
       values ($1, $2, $3, 'active', $4, $4, $5)`,
      [
        projectId,
        ids.workspace,
        `Fictional ${name} concurrency project`,
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

if (checks.some((item) => !item.condition)) {
  process.exitCode = 1
} else {
  console.log(
    `Project membership concurrency verification passed (${checks.length} checks).`,
  )
}
