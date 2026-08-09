#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 3.1 real PostgreSQL concurrency verifier.
 *
 * Every race uses two business connections and an observer that proves the
 * second backend is blocked by the first through pg_blocking_pids(). Fixtures
 * are random and fictional, timeouts keep CI bounded, and no URL or credential
 * is printed.
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
  if (result.status !== 0)
    throw new Error('Local Supabase status is unavailable.')
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
    // Preserve the original verification result.
  }
}

const BLOCKING_DEADLINE_MS = 6000
const POLL_INTERVAL_MS = 25

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
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    await first.query('commit')
    try {
      await secondPending
    } catch {
      // The rejection handler attached above captured the database error.
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

const ids = {
  owner: crypto.randomUUID(),
  lead: crypto.randomUUID(),
  admin: crypto.randomUUID(),
  assigneeRemoval: crypto.randomUUID(),
  assigneeSuspension: crypto.randomUUID(),
  assigneeStable: crypto.randomUUID(),
  collaboratorA: crypto.randomUUID(),
  collaboratorB: crypto.randomUUID(),
  collaboratorC: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  actorProject: crypto.randomUUID(),
  removalProject: crypto.randomUUID(),
  suspensionProject: crypto.randomUUID(),
  moduleProject: crypto.randomUUID(),
  archiveProject: crypto.randomUUID(),
  editProject: crypto.randomUUID(),
  replacementProject: crypto.randomUUID(),
}

const subjects = {
  owner: `task-concurrency-owner-${crypto.randomUUID()}`,
  lead: `task-concurrency-lead-${crypto.randomUUID()}`,
  admin: `task-concurrency-admin-${crypto.randomUUID()}`,
}

const projectIds = [
  ids.actorProject,
  ids.removalProject,
  ids.suspensionProject,
  ids.moduleProject,
  ids.archiveProject,
  ids.editProject,
  ids.replacementProject,
]
const moduleByProject = new Map(
  projectIds.map((projectId) => [projectId, crypto.randomUUID()]),
)
const taskByProject = new Map([
  [ids.editProject, crypto.randomUUID()],
  [ids.replacementProject, crypto.randomUUID()],
])
const allUserIds = [
  ids.owner,
  ids.lead,
  ids.admin,
  ids.assigneeRemoval,
  ids.assigneeSuspension,
  ids.assigneeStable,
  ids.collaboratorA,
  ids.collaboratorB,
  ids.collaboratorC,
]

async function setupFixtures() {
  const client = await connect()
  try {
    await client.query('begin')
    const labels = new Map([
      [ids.owner, 'owner'],
      [ids.lead, 'lead'],
      [ids.admin, 'admin'],
      [ids.assigneeRemoval, 'removal assignee'],
      [ids.assigneeSuspension, 'suspension assignee'],
      [ids.assigneeStable, 'stable assignee'],
      [ids.collaboratorA, 'collaborator A'],
      [ids.collaboratorB, 'collaborator B'],
      [ids.collaboratorC, 'collaborator C'],
    ])
    for (const userId of allUserIds) {
      await client.query(
        "insert into public.app_users (id,status) values ($1,'active')",
        [userId],
      )
      await client.query(
        'insert into public.profiles (user_id,display_name) values ($1,$2)',
        [userId, `Fictional task concurrency ${labels.get(userId)}`],
      )
    }
    for (const [userId, subject] of [
      [ids.owner, subjects.owner],
      [ids.lead, subjects.lead],
      [ids.admin, subjects.admin],
    ]) {
      await client.query(
        `insert into public.user_identities
           (user_id,provider,provider_tenant,provider_subject,verified_at)
         values ($1,'supabase_auth',$2,$3,now())`,
        [userId, issuer, subject],
      )
    }

    await client.query(
      `insert into public.workspaces (id,name,owner_id,created_by)
       values ($1,'Fictional task concurrency workspace',$2,$2)`,
      [ids.workspace, ids.owner],
    )
    for (const userId of allUserIds) {
      const role =
        userId === ids.owner
          ? 'owner'
          : userId === ids.admin
            ? 'admin'
            : 'member'
      await client.query(
        `insert into public.workspace_members
           (workspace_id,user_id,role,status,invited_by,joined_at)
         values ($1,$2,$3,'active',$4,now())`,
        [ids.workspace, userId, role, ids.owner],
      )
    }

    for (const projectId of projectIds) {
      const projectStatus =
        projectId === ids.archiveProject ? 'completed' : 'active'
      await client.query(
        `insert into public.projects
           (id,workspace_id,name,status,owner_id,lead_id,created_by,idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$5,$7)`,
        [
          projectId,
          ids.workspace,
          `Fictional task concurrency ${projectId.slice(0, 8)}`,
          projectStatus,
          ids.owner,
          ids.lead,
          crypto.randomUUID(),
        ],
      )
      await client.query(
        `insert into public.project_members (project_id,user_id,role) values
           ($1,$2,'owner'),($1,$3,'lead'),($1,$4,'member'),($1,$5,'member'),
           ($1,$6,'member'),($1,$7,'member'),($1,$8,'member'),($1,$9,'member')`,
        [
          projectId,
          ids.owner,
          ids.lead,
          ids.assigneeRemoval,
          ids.assigneeSuspension,
          ids.assigneeStable,
          ids.collaboratorA,
          ids.collaboratorB,
          ids.collaboratorC,
        ],
      )
      await client.query(
        `insert into public.project_modules
           (id,project_id,name,sort_position,created_by,updated_by)
         values ($1,$2,'Fictional task concurrency module',0,$3,$3)`,
        [moduleByProject.get(projectId), projectId, ids.owner],
      )
    }

    for (const projectId of [ids.editProject, ids.replacementProject]) {
      const taskId = taskByProject.get(projectId)
      await client.query(
        `insert into public.tasks
           (id,project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
        [
          taskId,
          projectId,
          moduleByProject.get(projectId),
          'Fictional task before concurrent edit',
          ids.assigneeStable,
          ids.lead,
          ids.owner,
          crypto.randomUUID(),
        ],
      )
      await client.query(
        'insert into public.task_collaborators (task_id,user_id) values ($1,$2)',
        [taskId, ids.collaboratorA],
      )
    }
    await client.query('commit')
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  } finally {
    await client.end()
  }
}

async function cleanupFixtures() {
  const client = await connect()
  try {
    await client.query('begin')
    await client.query('set local session_replication_role = replica')
    await client.query(
      'delete from public.task_visibility_users where task_id in (select id from public.tasks where project_id = any($1::uuid[]))',
      [projectIds],
    )
    await client.query(
      'delete from public.task_collaborators where task_id in (select id from public.tasks where project_id = any($1::uuid[]))',
      [projectIds],
    )
    await client.query(
      'delete from public.tasks where project_id = any($1::uuid[])',
      [projectIds],
    )
    await client.query(
      'delete from public.project_modules where project_id = any($1::uuid[])',
      [projectIds],
    )
    await client.query(
      'delete from public.project_members where project_id = any($1::uuid[])',
      [projectIds],
    )
    await client.query(
      'delete from public.projects where id = any($1::uuid[])',
      [projectIds],
    )
    await client.query(
      'delete from public.workspace_members where workspace_id = $1',
      [ids.workspace],
    )
    await client.query('delete from public.workspaces where id = $1', [
      ids.workspace,
    ])
    await client.query(
      'delete from public.user_identities where user_id = any($1::uuid[])',
      [allUserIds],
    )
    await client.query(
      'delete from public.profiles where user_id = any($1::uuid[])',
      [allUserIds],
    )
    await client.query(
      'delete from public.app_users where id = any($1::uuid[])',
      [allUserIds],
    )
    await client.query('commit')
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  } finally {
    await client.end()
  }
}

const createSql = `select * from public.create_task(
  $1,$2,$3,null,null,$4,array[]::uuid[],$5,'medium',null,null,null,'m','project',array[]::uuid[],$6
)`
const updateSql = `select * from public.update_task(
  $1,$2,$3,$4,null,null,$5,$6::uuid[],$7,'medium',null,null,null,'m','project',array[]::uuid[],$8
)`

async function projectVersion(projectId) {
  const client = await connect()
  try {
    return (
      await client.query(
        'select updated_at::text from public.projects where id=$1',
        [projectId],
      )
    ).rows[0].updated_at
  } finally {
    await client.end()
  }
}

async function taskVersion(taskId) {
  const client = await connect()
  try {
    return (
      await client.query(
        'select updated_at::text from public.tasks where id=$1',
        [taskId],
      )
    ).rows[0].updated_at
  } finally {
    await client.end()
  }
}

async function taskState(taskId) {
  const client = await connect()
  try {
    return (
      await client.query(
        `select t.title,
         coalesce(array_agg(tc.user_id order by tc.user_id) filter (where tc.user_id is not null),array[]::uuid[]) as collaborators
       from public.tasks t left join public.task_collaborators tc on tc.task_id=t.id
       where t.id=$1 group by t.id`,
        [taskId],
      )
    ).rows[0]
  } finally {
    await client.end()
  }
}

console.log('Task concurrency verification')
let setupComplete = false
try {
  await setupFixtures()
  setupComplete = true

  const actorRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.set_workspace_member_role($1,$2,$3)',
    firstParams: [ids.workspace, ids.admin, 'member'],
    secondActor: subjects.admin,
    secondSql: createSql,
    secondParams: [
      ids.actorProject,
      moduleByProject.get(ids.actorProject),
      'Denied stale admin create',
      ids.assigneeStable,
      ids.lead,
      crypto.randomUUID(),
    ],
  })
  check(
    'actor revocation: create genuinely waited on actor membership',
    actorRace.blockedObserved,
  )
  check(
    'actor revocation: demoted workspace admin is rejected after lock',
    actorRace.secondError?.code === '42501',
  )

  const removalRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.remove_project_member($1,$2)',
    firstParams: [ids.removalProject, ids.assigneeRemoval],
    secondActor: subjects.lead,
    secondSql: createSql,
    secondParams: [
      ids.removalProject,
      moduleByProject.get(ids.removalProject),
      'Denied removed assignee create',
      ids.assigneeRemoval,
      ids.lead,
      crypto.randomUUID(),
    ],
  })
  check(
    'assignee removal: create genuinely waited on project lock',
    removalRace.blockedObserved,
  )
  check(
    'assignee removal: removed candidate is rejected after lock',
    removalRace.secondError?.code === '22023',
  )

  const suspensionRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.set_workspace_member_status($1,$2,$3)',
    firstParams: [ids.workspace, ids.assigneeSuspension, 'suspended'],
    secondActor: subjects.lead,
    secondSql: createSql,
    secondParams: [
      ids.suspensionProject,
      moduleByProject.get(ids.suspensionProject),
      'Denied suspended assignee create',
      ids.assigneeSuspension,
      ids.lead,
      crypto.randomUUID(),
    ],
  })
  check(
    'assignee suspension: create genuinely waited on candidate membership',
    suspensionRace.blockedObserved,
  )
  check(
    'assignee suspension: suspended candidate is rejected after lock',
    suspensionRace.secondError?.code === '22023',
  )

  const moduleRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.delete_project_module($1,$2)',
    firstParams: [ids.moduleProject, moduleByProject.get(ids.moduleProject)],
    secondActor: subjects.lead,
    secondSql: createSql,
    secondParams: [
      ids.moduleProject,
      moduleByProject.get(ids.moduleProject),
      'Denied deleted module create',
      ids.assigneeStable,
      ids.lead,
      crypto.randomUUID(),
    ],
  })
  check(
    'module deletion: create genuinely waited on project lock',
    moduleRace.blockedObserved,
  )
  check(
    'module deletion: deleted module is rejected after lock',
    moduleRace.secondError?.code === '22023',
  )

  const archiveVersion = await projectVersion(ids.archiveProject)
  const archiveRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1,$2)',
    firstParams: [ids.archiveProject, archiveVersion],
    secondActor: subjects.lead,
    secondSql: createSql,
    secondParams: [
      ids.archiveProject,
      moduleByProject.get(ids.archiveProject),
      'Denied archived create',
      ids.assigneeStable,
      ids.lead,
      crypto.randomUUID(),
    ],
  })
  check(
    'project archive: create genuinely waited on project lock',
    archiveRace.blockedObserved,
  )
  check(
    'project archive: archived project is rejected after lock',
    archiveRace.secondError?.code === '55000',
  )

  const editTaskId = taskByProject.get(ids.editProject)
  const editVersion = await taskVersion(editTaskId)
  const editRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: updateSql,
    firstParams: [
      ids.editProject,
      editTaskId,
      moduleByProject.get(ids.editProject),
      'Winning concurrent edit',
      ids.assigneeStable,
      [ids.collaboratorB],
      ids.lead,
      editVersion,
    ],
    secondActor: subjects.lead,
    secondSql: updateSql,
    secondParams: [
      ids.editProject,
      editTaskId,
      moduleByProject.get(ids.editProject),
      'Stale concurrent edit',
      ids.assigneeStable,
      [ids.collaboratorC],
      ids.lead,
      editVersion,
    ],
  })
  check(
    'concurrent edit: stale writer genuinely waited on project lock',
    editRace.blockedObserved,
  )
  check(
    'concurrent edit: stale expected version is rejected',
    editRace.secondError?.code === '40001',
  )
  const editState = await taskState(editTaskId)
  check(
    'concurrent edit: winning title is preserved',
    editState.title === 'Winning concurrent edit',
  )

  const replacementTaskId = taskByProject.get(ids.replacementProject)
  const replacementVersion = await taskVersion(replacementTaskId)
  const replacementRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: updateSql,
    firstParams: [
      ids.replacementProject,
      replacementTaskId,
      moduleByProject.get(ids.replacementProject),
      'Replacement winner',
      ids.assigneeStable,
      [ids.collaboratorB],
      ids.lead,
      replacementVersion,
    ],
    secondActor: subjects.lead,
    secondSql: updateSql,
    secondParams: [
      ids.replacementProject,
      replacementTaskId,
      moduleByProject.get(ids.replacementProject),
      'Replacement stale',
      ids.assigneeStable,
      [ids.collaboratorC],
      ids.lead,
      replacementVersion,
    ],
  })
  check(
    'collaborator replacement: second complete-set write genuinely waited',
    replacementRace.blockedObserved,
  )
  check(
    'collaborator replacement: stale complete-set write is rejected',
    replacementRace.secondError?.code === '40001',
  )
  const replacementState = await taskState(replacementTaskId)
  check(
    'collaborator replacement: final set is one complete winner, never a partial union',
    replacementState.collaborators.length === 1 &&
      replacementState.collaborators[0] === ids.collaboratorB,
  )
} finally {
  if (setupComplete) await cleanupFixtures()
}

const failed = checks.filter((item) => !item.condition)
if (failed.length > 0) {
  console.error(
    `Task concurrency verification failed: ${failed.length} checks.`,
  )
  process.exit(1)
}
console.log(`Task concurrency verification passed: ${checks.length} checks.`)
