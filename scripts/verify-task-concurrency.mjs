#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 3.1/3.3 real PostgreSQL concurrency verifier.
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
  let secondResult
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
      secondResult = await secondPending
    } catch {
      // The rejection handler attached above captured the database error.
    }
    if (secondError) await rollbackQuietly(second)
    else await second.query('commit')
    return { blockedObserved, firstResult, secondError, secondResult }
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
  sameKeyProject: crypto.randomUUID(),
  differentKeyProject: crypto.randomUUID(),
  blockCancelProject: crypto.randomUUID(),
  resumeCancelProject: crypto.randomUUID(),
  transitionEditProject: crypto.randomUUID(),
  editTransitionProject: crypto.randomUUID(),
  archiveTransitionProject: crypto.randomUUID(),
  transitionArchiveProject: crypto.randomUUID(),
}

const subjects = {
  owner: `task-concurrency-owner-${crypto.randomUUID()}`,
  lead: `task-concurrency-lead-${crypto.randomUUID()}`,
  admin: `task-concurrency-admin-${crypto.randomUUID()}`,
  assignee: `task-concurrency-assignee-${crypto.randomUUID()}`,
}

const projectIds = [
  ids.actorProject,
  ids.removalProject,
  ids.suspensionProject,
  ids.moduleProject,
  ids.archiveProject,
  ids.editProject,
  ids.replacementProject,
  ids.sameKeyProject,
  ids.differentKeyProject,
  ids.blockCancelProject,
  ids.resumeCancelProject,
  ids.transitionEditProject,
  ids.editTransitionProject,
  ids.archiveTransitionProject,
  ids.transitionArchiveProject,
]
const moduleByProject = new Map(
  projectIds.map((projectId) => [projectId, crypto.randomUUID()]),
)
const taskByProject = new Map(
  [
    ids.editProject,
    ids.replacementProject,
    ids.sameKeyProject,
    ids.differentKeyProject,
    ids.blockCancelProject,
    ids.resumeCancelProject,
    ids.transitionEditProject,
    ids.editTransitionProject,
    ids.archiveTransitionProject,
    ids.transitionArchiveProject,
  ].map((projectId) => [projectId, crypto.randomUUID()]),
)
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
      [ids.assigneeStable, subjects.assignee],
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
      const projectStatus = [
        ids.archiveProject,
        ids.archiveTransitionProject,
        ids.transitionArchiveProject,
      ].includes(projectId)
        ? 'completed'
        : 'active'
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

    for (const [projectId, taskId] of taskByProject) {
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
      if ([ids.editProject, ids.replacementProject].includes(projectId)) {
        await client.query(
          'insert into public.task_collaborators (task_id,user_id) values ($1,$2)',
          [taskId, ids.collaboratorA],
        )
      }
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
      'delete from public.task_status_history where task_id in (select id from public.tasks where project_id = any($1::uuid[]))',
      [projectIds],
    )
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
const startSql = 'select public.start_task($1,$2) as transition'
const blockSql = 'select public.block_task($1,$2,$3) as transition'
const resumeSql = 'select public.resume_task($1,$2) as transition'
const cancelSql = 'select public.cancel_task($1,$2) as transition'

async function runActor(subject, sql, params) {
  const client = await connect()
  try {
    await beginActor(client, subject)
    const result = await client.query(sql, params)
    await client.query('commit')
    return result
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  } finally {
    await client.end()
  }
}

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
        `select t.title,t.status,t.blocker_reason,t.blocked_at,t.blocked_by,t.updated_at::text,
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

async function transitionState(taskId) {
  const client = await connect()
  try {
    return (
      await client.query(
        `select transition_seq::integer as transition_seq,from_status,to_status,action,reason
         from public.task_status_history
         where task_id=$1 order by transition_seq`,
        [taskId],
      )
    ).rows
  } finally {
    await client.end()
  }
}

async function projectStatus(projectId) {
  const client = await connect()
  try {
    return (
      await client.query('select status from public.projects where id=$1', [
        projectId,
      ])
    ).rows[0].status
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

  const sameKeyTaskId = taskByProject.get(ids.sameKeyProject)
  const sameKey = crypto.randomUUID()
  const sameKeyRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: startSql,
    firstParams: [sameKeyTaskId, sameKey],
    secondActor: subjects.assignee,
    secondSql: startSql,
    secondParams: [sameKeyTaskId, sameKey],
  })
  check(
    'same-key start: duplicate genuinely waited on the task write chain',
    sameKeyRace.blockedObserved,
  )
  check(
    'same-key start: both calls complete without a database error',
    sameKeyRace.secondError === null,
  )
  check(
    'same-key start: first call is new and second call is an idempotent replay',
    sameKeyRace.firstResult.rows[0].transition.was_existing === false &&
      sameKeyRace.secondResult?.rows[0].transition.was_existing === true,
  )
  const sameKeyHistory = await transitionState(sameKeyTaskId)
  check(
    'same-key start: exactly one start history row exists',
    sameKeyHistory.length === 1 &&
      sameKeyHistory[0].action === 'start' &&
      sameKeyHistory[0].transition_seq === 1,
  )

  const differentKeyTaskId = taskByProject.get(ids.differentKeyProject)
  const differentKeyRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: startSql,
    firstParams: [differentKeyTaskId, crypto.randomUUID()],
    secondActor: subjects.assignee,
    secondSql: startSql,
    secondParams: [differentKeyTaskId, crypto.randomUUID()],
  })
  check(
    'different-key start: losing writer genuinely waited',
    differentKeyRace.blockedObserved,
  )
  check(
    'different-key start: one succeeds and the later intent is invalid',
    differentKeyRace.secondError?.code === '55000',
  )
  const differentKeyState = await taskState(differentKeyTaskId)
  const differentKeyHistory = await transitionState(differentKeyTaskId)
  check(
    'different-key start: final state and history contain one legal transition',
    differentKeyState.status === 'in_progress' &&
      differentKeyHistory.length === 1 &&
      differentKeyHistory[0].from_status === 'todo' &&
      differentKeyHistory[0].to_status === 'in_progress',
  )

  const blockCancelTaskId = taskByProject.get(ids.blockCancelProject)
  await runActor(subjects.assignee, startSql, [
    blockCancelTaskId,
    crypto.randomUUID(),
  ])
  const blockCancelRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: blockSql,
    firstParams: [
      blockCancelTaskId,
      'Fictional dependency for block cancel race',
      crypto.randomUUID(),
    ],
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [blockCancelTaskId, crypto.randomUUID()],
  })
  check(
    'block vs cancel: cancel genuinely waited behind block',
    blockCancelRace.blockedObserved,
  )
  check(
    'block vs cancel: both legal serial transitions complete without deadlock',
    blockCancelRace.secondError === null,
  )
  const blockCancelState = await taskState(blockCancelTaskId)
  const blockCancelHistory = await transitionState(blockCancelTaskId)
  check(
    'block vs cancel: final cancelled state has no stale current blocker',
    blockCancelState.status === 'cancelled' &&
      blockCancelState.blocker_reason === null &&
      blockCancelState.blocked_at === null &&
      blockCancelState.blocked_by === null,
  )
  check(
    'block vs cancel: history is the continuous start-block-cancel chain',
    blockCancelHistory.length === 3 &&
      blockCancelHistory.every(
        (row, index) =>
          row.transition_seq === index + 1 &&
          (index === 0 ||
            blockCancelHistory[index - 1].to_status === row.from_status),
      ) &&
      blockCancelHistory[1].reason ===
        'Fictional dependency for block cancel race' &&
      blockCancelHistory[2].to_status === 'cancelled',
  )

  const resumeCancelTaskId = taskByProject.get(ids.resumeCancelProject)
  await runActor(subjects.assignee, startSql, [
    resumeCancelTaskId,
    crypto.randomUUID(),
  ])
  await runActor(subjects.assignee, blockSql, [
    resumeCancelTaskId,
    'Fictional dependency for resume cancel race',
    crypto.randomUUID(),
  ])
  const resumeCancelRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: resumeSql,
    firstParams: [resumeCancelTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [resumeCancelTaskId, crypto.randomUUID()],
  })
  check(
    'resume vs cancel: cancel genuinely waited behind resume',
    resumeCancelRace.blockedObserved,
  )
  check(
    'resume vs cancel: both legal serial transitions complete without deadlock',
    resumeCancelRace.secondError === null,
  )
  const resumeCancelState = await taskState(resumeCancelTaskId)
  const resumeCancelHistory = await transitionState(resumeCancelTaskId)
  check(
    'resume vs cancel: final terminal state clears current blocker fields',
    resumeCancelState.status === 'cancelled' &&
      resumeCancelState.blocker_reason === null &&
      resumeCancelState.blocked_at === null &&
      resumeCancelState.blocked_by === null,
  )
  check(
    'resume vs cancel: history remains continuous through four transitions',
    resumeCancelHistory.length === 4 &&
      resumeCancelHistory.every(
        (row, index) =>
          row.transition_seq === index + 1 &&
          (index === 0 ||
            resumeCancelHistory[index - 1].to_status === row.from_status),
      ) &&
      resumeCancelHistory[3].to_status === 'cancelled',
  )

  const transitionEditTaskId = taskByProject.get(ids.transitionEditProject)
  const transitionEditVersion = await taskVersion(transitionEditTaskId)
  const transitionEditRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: startSql,
    firstParams: [transitionEditTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: updateSql,
    secondParams: [
      ids.transitionEditProject,
      transitionEditTaskId,
      moduleByProject.get(ids.transitionEditProject),
      'Stale metadata after transition',
      ids.assigneeStable,
      [],
      ids.lead,
      transitionEditVersion,
    ],
  })
  check(
    'transition then metadata: stale edit genuinely waited on project lock',
    transitionEditRace.blockedObserved,
  )
  check(
    'transition then metadata: old expected version is rejected without deadlock',
    transitionEditRace.secondError?.code === '40001',
  )
  const transitionEditState = await taskState(transitionEditTaskId)
  check(
    'transition then metadata: status wins and stale title is not written',
    transitionEditState.status === 'in_progress' &&
      transitionEditState.title === 'Fictional task before concurrent edit',
  )

  const editTransitionTaskId = taskByProject.get(ids.editTransitionProject)
  const editTransitionVersion = await taskVersion(editTransitionTaskId)
  const editTransitionRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: updateSql,
    firstParams: [
      ids.editTransitionProject,
      editTransitionTaskId,
      moduleByProject.get(ids.editTransitionProject),
      'Metadata committed before transition',
      ids.assigneeStable,
      [],
      ids.lead,
      editTransitionVersion,
    ],
    secondActor: subjects.assignee,
    secondSql: startSql,
    secondParams: [editTransitionTaskId, crypto.randomUUID()],
  })
  check(
    'metadata then transition: transition genuinely waited on project lock',
    editTransitionRace.blockedObserved,
  )
  check(
    'metadata then transition: transition completes without deadlock',
    editTransitionRace.secondError === null,
  )
  const editTransitionState = await taskState(editTransitionTaskId)
  check(
    'metadata then transition: committed metadata and new status are both preserved',
    editTransitionState.title === 'Metadata committed before transition' &&
      editTransitionState.status === 'in_progress',
  )

  const archiveTransitionTaskId = taskByProject.get(
    ids.archiveTransitionProject,
  )
  const archiveTransitionVersion = await projectVersion(
    ids.archiveTransitionProject,
  )
  const archiveTransitionRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1,$2)',
    firstParams: [ids.archiveTransitionProject, archiveTransitionVersion],
    secondActor: subjects.assignee,
    secondSql: startSql,
    secondParams: [archiveTransitionTaskId, crypto.randomUUID()],
  })
  check(
    'archive then transition: transition genuinely waited on project lock',
    archiveTransitionRace.blockedObserved,
  )
  check(
    'archive then transition: archived project rejects the later mutation',
    archiveTransitionRace.secondError?.code === '55000',
  )
  check(
    'archive then transition: task remains todo with no history residue',
    (await taskState(archiveTransitionTaskId)).status === 'todo' &&
      (await transitionState(archiveTransitionTaskId)).length === 0,
  )

  const transitionArchiveTaskId = taskByProject.get(
    ids.transitionArchiveProject,
  )
  const transitionArchiveVersion = await projectVersion(
    ids.transitionArchiveProject,
  )
  const transitionArchiveRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: startSql,
    firstParams: [transitionArchiveTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: 'select * from public.archive_project($1,$2)',
    secondParams: [ids.transitionArchiveProject, transitionArchiveVersion],
  })
  check(
    'transition then archive: archive genuinely waited on project lock',
    transitionArchiveRace.blockedObserved,
  )
  check(
    'transition then archive: both serial operations complete without deadlock',
    transitionArchiveRace.secondError === null,
  )
  check(
    'transition then archive: transition persists and project ends archived',
    (await taskState(transitionArchiveTaskId)).status === 'in_progress' &&
      (await transitionState(transitionArchiveTaskId)).length === 1 &&
      (await projectStatus(ids.transitionArchiveProject)) === 'archived',
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
