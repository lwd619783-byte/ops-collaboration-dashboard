#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 2.3 real PostgreSQL concurrency verifier.
 *
 * Uses only the local Supabase stack and random fictional fixtures. Every race
 * has two business connections plus an observer that proves the second backend
 * is blocked by the first through pg_blocking_pids(). No scenario relies on a
 * fixed sleep to guess serialization. Local lock_timeout and statement_timeout
 * keep CI bounded, every pending rejection is handled immediately, and exact
 * fixture ids are removed in a final cleanup transaction.
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
  await client.query("set local lock_timeout = '20s'")
  await client.query("set local statement_timeout = '30s'")
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback')
  } catch {
    // The original verification result remains authoritative.
  }
}

const BLOCKING_DEADLINE_MS = 6000
const POLL_INTERVAL_MS = 25

function shortPollDelay() {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
}

async function lockWaitRace({
  firstActor,
  firstSql,
  firstParams,
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
  try {
    await beginActor(first, firstActor)
    await beginActor(second, secondActor)

    const firstPid = (await first.query('select pg_backend_pid() as pid'))
      .rows[0].pid
    const secondPid = (await second.query('select pg_backend_pid() as pid'))
      .rows[0].pid

    firstResult = await first.query(firstSql, firstParams)

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
      if (probe.rows[0]?.blocked === true) {
        blockedObserved = true
        break
      }
      await shortPollDelay()
    }

    await first.query('commit')
    try {
      await secondPending
    } catch {
      // The rejection handler attached at creation already captured the error.
    }
    if (secondError) await rollbackQuietly(second)
    else await second.query('commit')

    return { blockedObserved, firstResult, secondError }
  } finally {
    await rollbackQuietly(first)
    await rollbackQuietly(second)
    await rollbackQuietly(observer)
    await first.end()
    await second.end()
    await observer.end()
  }
}

async function actorQuery(subject, sql, params) {
  const client = await connect()
  try {
    await beginActor(client, subject)
    const result = await client.query(sql, params)
    await client.query('commit')
    return { result, error: null }
  } catch (error) {
    await rollbackQuietly(client)
    return { result: null, error }
  } finally {
    await client.end()
  }
}

const ids = {
  owner: crypto.randomUUID(),
  admin: crypto.randomUUID(),
  lead: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  createProjectKey: crypto.randomUUID(),
  addProject: crypto.randomUUID(),
  reorderProject: crypto.randomUUID(),
  deleteProject: crypto.randomUUID(),
  revokeProject: crypto.randomUUID(),
  archiveProject: crypto.randomUUID(),
  isolationProject: crypto.randomUUID(),
  otherProject: crypto.randomUUID(),
}

const subjects = {
  owner: `module-concurrency-owner-${crypto.randomUUID()}`,
  admin: `module-concurrency-admin-${crypto.randomUUID()}`,
  lead: `module-concurrency-lead-${crypto.randomUUID()}`,
}

const projectIds = [
  ids.addProject,
  ids.reorderProject,
  ids.deleteProject,
  ids.revokeProject,
  ids.archiveProject,
  ids.isolationProject,
  ids.otherProject,
]
const userIds = [ids.owner, ids.admin, ids.lead]
const moduleIdsByProject = new Map()

function moduleIds(projectId, count) {
  const values = Array.from({ length: count }, () => crypto.randomUUID())
  moduleIdsByProject.set(projectId, values)
  return values
}

const fixtures = {
  add: moduleIds(ids.addProject, 1),
  reorder: moduleIds(ids.reorderProject, 3),
  remove: moduleIds(ids.deleteProject, 3),
  revoke: moduleIds(ids.revokeProject, 1),
  archive: moduleIds(ids.archiveProject, 1),
  isolation: moduleIds(ids.isolationProject, 2),
  other: moduleIds(ids.otherProject, 1),
}

async function setupFixtures() {
  const setup = await connect()
  try {
    await setup.query('begin')
    for (const [userId, subject, label] of [
      [ids.owner, subjects.owner, 'owner'],
      [ids.admin, subjects.admin, 'admin'],
      [ids.lead, subjects.lead, 'lead'],
    ]) {
      await setup.query(
        `insert into public.app_users (id, status) values ($1, 'active')`,
        [userId],
      )
      await setup.query(
        `insert into public.profiles (user_id, display_name) values ($1, $2)`,
        [userId, `Fictional module concurrency ${label}`],
      )
      await setup.query(
        `insert into public.user_identities
           (user_id, provider, provider_tenant, provider_subject, verified_at)
         values ($1, 'supabase_auth', $2, $3, now())`,
        [userId, issuer, subject],
      )
    }

    await setup.query(
      `insert into public.workspaces (id, name, owner_id, created_by)
       values ($1, 'Fictional module concurrency workspace', $2, $2)`,
      [ids.workspace, ids.owner],
    )
    await setup.query(
      `insert into public.workspace_members
         (workspace_id, user_id, role, status, invited_by, joined_at)
       values
         ($1, $2, 'owner', 'active', $2, now()),
         ($1, $3, 'admin', 'active', $2, now()),
         ($1, $4, 'member', 'active', $2, now())`,
      [ids.workspace, ids.owner, ids.admin, ids.lead],
    )

    for (const projectId of projectIds) {
      const completed = projectId === ids.archiveProject
      await setup.query(
        `insert into public.projects
           (id, workspace_id, name, status, owner_id, lead_id, created_by, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $5, $7)`,
        [
          projectId,
          ids.workspace,
          `Fictional module concurrency ${projectId.slice(0, 8)}`,
          completed ? 'completed' : 'active',
          ids.owner,
          ids.lead,
          crypto.randomUUID(),
        ],
      )
      await setup.query(
        `insert into public.project_members (project_id, user_id, role)
         values ($1, $2, 'owner'), ($1, $3, 'lead')`,
        [projectId, ids.owner, ids.lead],
      )
      const projectModuleIds = moduleIdsByProject.get(projectId)
      for (const [position, moduleId] of projectModuleIds.entries()) {
        await setup.query(
          `insert into public.project_modules
             (id, project_id, name, sort_position, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $5)`,
          [
            moduleId,
            projectId,
            `Fictional module ${position + 1}`,
            position,
            ids.owner,
          ],
        )
      }
    }
    await setup.query('commit')
  } catch (error) {
    await rollbackQuietly(setup)
    throw error
  } finally {
    await setup.end()
  }
}

async function cleanupFixtures() {
  const cleanup = await connect()
  try {
    await cleanup.query('begin')
    await cleanup.query('set local session_replication_role = replica')
    await cleanup.query(
      `delete from public.project_modules
       where project_id in (
         select id from public.projects where workspace_id = $1
       )`,
      [ids.workspace],
    )
    await cleanup.query(
      `delete from public.project_members
       where project_id in (
         select id from public.projects where workspace_id = $1
       )`,
      [ids.workspace],
    )
    await cleanup.query('delete from public.projects where workspace_id = $1', [
      ids.workspace,
    ])
    await cleanup.query(
      'delete from public.workspace_members where workspace_id = $1',
      [ids.workspace],
    )
    await cleanup.query('delete from public.workspaces where id = $1', [
      ids.workspace,
    ])
    await cleanup.query(
      'delete from public.user_identities where user_id = any($1::uuid[])',
      [userIds],
    )
    await cleanup.query(
      'delete from public.profiles where user_id = any($1::uuid[])',
      [userIds],
    )
    await cleanup.query(
      'delete from public.app_users where id = any($1::uuid[])',
      [userIds],
    )
    await cleanup.query('commit')
  } catch (error) {
    await rollbackQuietly(cleanup)
    throw error
  } finally {
    await cleanup.end()
  }
}

async function readProjectState(projectId) {
  const read = await connect()
  try {
    return (
      await read.query(
        `select
           array_agg(id order by sort_position, id) filter (where deleted_at is null) as ids,
           array_agg(sort_position order by sort_position) filter (where deleted_at is null) as positions,
           array_agg(name order by sort_position, id) filter (where deleted_at is null) as names,
           count(*) filter (where deleted_at is not null)::int as deleted_count
         from public.project_modules
         where project_id = $1`,
        [projectId],
      )
    ).rows[0]
  } finally {
    await read.end()
  }
}

async function readCreationResidue(idempotencyKey) {
  const read = await connect()
  try {
    return (
      await read.query(
        `select
           (select count(*)::int
            from public.projects
            where idempotency_key = $1) as project_count,
           (select count(*)::int
            from public.project_members as pm
            join public.projects as p on p.id = pm.project_id
            where p.idempotency_key = $1) as project_member_count,
           (select count(*)::int
            from public.project_modules as m
            join public.projects as p on p.id = m.project_id
            where p.idempotency_key = $1) as project_module_count`,
        [idempotencyKey],
      )
    ).rows[0]
  } finally {
    await read.end()
  }
}

console.log('Project module concurrency verification')

let setupComplete = false
try {
  await setupFixtures()
  setupComplete = true

  const versions = await connect()
  let revokeVersion
  let archiveVersion
  try {
    revokeVersion = (
      await versions.query(
        'select updated_at::text from public.projects where id = $1',
        [ids.revokeProject],
      )
    ).rows[0].updated_at
    archiveVersion = (
      await versions.query(
        'select updated_at::text from public.projects where id = $1',
        [ids.archiveProject],
      )
    ).rows[0].updated_at
  } finally {
    await versions.end()
  }

  const creatorDemotionRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.set_workspace_member_role($1, $2, $3)',
    firstParams: [ids.workspace, ids.admin, 'member'],
    secondActor: subjects.admin,
    secondSql: `select * from public.create_project(
      $1, $2, null, 'operations', 'planning', null, null, $3, true
    )`,
    secondParams: [
      ids.workspace,
      'Fictional denied concurrent project create',
      ids.createProjectKey,
    ],
  })
  check(
    'creator demotion while waiting: owner role update completed',
    creatorDemotionRace.firstResult.rows[0]?.role === 'member',
  )
  check(
    'creator demotion while waiting: create was genuinely blocked on the admin membership row',
    creatorDemotionRace.blockedObserved,
  )
  check(
    'creator demotion while waiting: lock-after-auth rejects the stale admin permission',
    creatorDemotionRace.secondError?.code === '42501',
  )
  const creatorResidue = await readCreationResidue(ids.createProjectKey)
  check(
    'creator demotion while waiting: denied request leaves no project',
    creatorResidue.project_count === 0,
  )
  check(
    'creator demotion while waiting: denied request leaves no project owner relation',
    creatorResidue.project_member_count === 0,
  )
  check(
    'creator demotion while waiting: denied preset request leaves no modules',
    creatorResidue.project_module_count === 0,
  )

  const addRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.add_project_module($1, $2)',
    firstParams: [ids.addProject, 'Fictional concurrent owner add'],
    secondActor: subjects.lead,
    secondSql: 'select * from public.add_project_module($1, $2)',
    secondParams: [ids.addProject, 'Fictional concurrent lead add'],
  })
  check(
    'concurrent add: second actor was genuinely blocked on the project row',
    addRace.blockedObserved,
  )
  check(
    'concurrent add: first owner insert completed',
    addRace.firstResult.rows.some(
      (row) => row.name === 'Fictional concurrent owner add',
    ),
  )
  check(
    'concurrent add: blocked lead insert also completed',
    addRace.secondError === null,
  )
  const addState = await readProjectState(ids.addProject)
  check(
    'concurrent add: final positions are unique and continuous',
    JSON.stringify(addState.positions) === JSON.stringify([0, 1, 2]),
  )
  check(
    'concurrent add: both concurrent names exist exactly once',
    addState.names.filter((name) => name.includes('concurrent')).length === 2 &&
      new Set(addState.names).size === addState.names.length,
  )

  const firstOrder = [
    fixtures.reorder[2],
    fixtures.reorder[0],
    fixtures.reorder[1],
  ]
  const secondOrder = [
    fixtures.reorder[1],
    fixtures.reorder[2],
    fixtures.reorder[0],
  ]
  const reorderRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.reorder_project_modules($1, $2)',
    firstParams: [ids.reorderProject, firstOrder],
    secondActor: subjects.lead,
    secondSql: 'select * from public.reorder_project_modules($1, $2)',
    secondParams: [ids.reorderProject, secondOrder],
  })
  check(
    'concurrent reorder: second actor was genuinely blocked on the project row',
    reorderRace.blockedObserved,
  )
  check(
    'concurrent reorder: both complete-order transactions succeeded',
    reorderRace.secondError === null,
  )
  const reorderState = await readProjectState(ids.reorderProject)
  check(
    'concurrent reorder: final state is the complete second order, never a partial merge',
    JSON.stringify(reorderState.ids) === JSON.stringify(secondOrder),
  )
  check(
    'concurrent reorder: positions remain continuous',
    JSON.stringify(reorderState.positions) === JSON.stringify([0, 1, 2]),
  )

  const deleteRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.delete_project_module($1, $2)',
    firstParams: [ids.deleteProject, fixtures.remove[1]],
    secondActor: subjects.lead,
    secondSql: 'select * from public.reorder_project_modules($1, $2)',
    secondParams: [ids.deleteProject, fixtures.remove],
  })
  check(
    'delete versus reorder: reorder was genuinely blocked on the project row',
    deleteRace.blockedObserved,
  )
  check(
    'delete versus reorder: stale full list is rejected after committed delete',
    deleteRace.secondError?.code === '22023',
  )
  const deleteState = await readProjectState(ids.deleteProject)
  check(
    'delete versus reorder: one history row remains deleted',
    deleteState.deleted_count === 1,
  )
  check(
    'delete versus reorder: surviving active positions are compact and complete',
    JSON.stringify(deleteState.positions) === JSON.stringify([0, 1]),
  )

  const revokeRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.clear_project_lead($1, $2)',
    firstParams: [ids.revokeProject, revokeVersion],
    secondActor: subjects.lead,
    secondSql: 'select * from public.add_project_module($1, $2)',
    secondParams: [ids.revokeProject, 'Fictional denied after demotion'],
  })
  check(
    'actor demotion while waiting: module writer was genuinely blocked',
    revokeRace.blockedObserved,
  )
  check(
    'actor demotion while waiting: permission is revalidated after the lock',
    revokeRace.secondError?.code === '42501',
  )
  const revokeState = await readProjectState(ids.revokeProject)
  check(
    'actor demotion while waiting: denied write created no module',
    revokeState.names.length === 1,
  )

  const archiveRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1, $2)',
    firstParams: [ids.archiveProject, archiveVersion],
    secondActor: subjects.lead,
    secondSql: 'select * from public.add_project_module($1, $2)',
    secondParams: [ids.archiveProject, 'Fictional denied after archive'],
  })
  check(
    'archive while waiting: module writer was genuinely blocked',
    archiveRace.blockedObserved,
  )
  check(
    'archive while waiting: locked write rechecks archive state and fails',
    archiveRace.secondError?.code === '55000',
  )
  const archiveState = await readProjectState(ids.archiveProject)
  check(
    'archive while waiting: denied write created no module',
    archiveState.names.length === 1,
  )

  const isolationBefore = await readProjectState(ids.isolationProject)
  const isolationAttempt = await actorQuery(
    subjects.owner,
    'select * from public.reorder_project_modules($1, $2)',
    [ids.isolationProject, [fixtures.isolation[0], fixtures.other[0]]],
  )
  check(
    'cross-project ordering: foreign module id is rejected',
    isolationAttempt.error?.code === '22023',
  )
  const isolationAfter = await readProjectState(ids.isolationProject)
  check(
    'cross-project ordering: rejected call leaves current project order unchanged',
    JSON.stringify(isolationAfter.ids) === JSON.stringify(isolationBefore.ids),
  )
  const otherState = await readProjectState(ids.otherProject)
  check(
    'cross-project ordering: foreign project keeps its own module unchanged',
    JSON.stringify(otherState.ids) === JSON.stringify(fixtures.other),
  )
} finally {
  if (setupComplete) await cleanupFixtures()
}

const failed = checks.filter((item) => !item.condition)
if (failed.length > 0) {
  console.error(
    `Project module concurrency verification failed: ${failed.length} checks.`,
  )
  process.exit(1)
}

console.log(
  `Project module concurrency verification passed: ${checks.length} checks.`,
)
