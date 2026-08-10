#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 3.1/3.3/3.4 real PostgreSQL concurrency verifier.
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

async function beginSystem(client) {
  await client.query('begin')
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
    await (firstActor === null
      ? beginSystem(first)
      : beginActor(first, firstActor))
    await (secondActor === null
      ? beginSystem(second)
      : beginActor(second, secondActor))
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
  assigneeAccount: crypto.randomUUID(),
  reviewerSpecial: crypto.randomUUID(),
  reviewerWorkspace: crypto.randomUUID(),
  reviewerAccount: crypto.randomUUID(),
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
  updateSameKeyProject: crypto.randomUUID(),
  updateDifferentKeyProject: crypto.randomUUID(),
  updateCancelProject: crypto.randomUUID(),
  updateBlockCancelProject: crypto.randomUUID(),
  updateEditProject: crypto.randomUUID(),
  updateArchiveProject: crypto.randomUUID(),
  updateAssigneeProject: crypto.randomUUID(),
  reviewSubmitSameKeyProject: crypto.randomUUID(),
  reviewSubmitDifferentKeyProject: crypto.randomUUID(),
  reviewSubmitCancelProject: crypto.randomUUID(),
  reviewSubmitProgressProject: crypto.randomUUID(),
  reviewSubmitEditProject: crypto.randomUUID(),
  reviewSubmitArchiveProject: crypto.randomUUID(),
  reviewSubmitAssigneeProject: crypto.randomUUID(),
  reviewSubmitRemovalProject: crypto.randomUUID(),
  reviewSubmitWorkspaceProject: crypto.randomUUID(),
  reviewSubmitAccountProject: crypto.randomUUID(),
  reviewApproveSameKeyProject: crypto.randomUUID(),
  reviewApproveDifferentKeyProject: crypto.randomUUID(),
  reviewApproveReturnProject: crypto.randomUUID(),
  reviewApproveArchiveProject: crypto.randomUUID(),
  reviewApproveRemovalProject: crypto.randomUUID(),
  reviewApproveWorkspaceProject: crypto.randomUUID(),
  reviewApproveAccountProject: crypto.randomUUID(),
  reviewReturnCancelProject: crypto.randomUUID(),
}

const subjects = {
  owner: `task-concurrency-owner-${crypto.randomUUID()}`,
  lead: `task-concurrency-lead-${crypto.randomUUID()}`,
  admin: `task-concurrency-admin-${crypto.randomUUID()}`,
  assignee: `task-concurrency-assignee-${crypto.randomUUID()}`,
  assigneeAccount: `task-concurrency-account-assignee-${crypto.randomUUID()}`,
  reviewerSpecial: `task-concurrency-reviewer-${crypto.randomUUID()}`,
  reviewerWorkspace: `task-concurrency-workspace-reviewer-${crypto.randomUUID()}`,
  reviewerAccount: `task-concurrency-account-reviewer-${crypto.randomUUID()}`,
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
  ids.updateSameKeyProject,
  ids.updateDifferentKeyProject,
  ids.updateCancelProject,
  ids.updateBlockCancelProject,
  ids.updateEditProject,
  ids.updateArchiveProject,
  ids.updateAssigneeProject,
  ids.reviewSubmitSameKeyProject,
  ids.reviewSubmitDifferentKeyProject,
  ids.reviewSubmitCancelProject,
  ids.reviewSubmitProgressProject,
  ids.reviewSubmitEditProject,
  ids.reviewSubmitArchiveProject,
  ids.reviewSubmitAssigneeProject,
  ids.reviewSubmitRemovalProject,
  ids.reviewSubmitWorkspaceProject,
  ids.reviewSubmitAccountProject,
  ids.reviewApproveSameKeyProject,
  ids.reviewApproveDifferentKeyProject,
  ids.reviewApproveReturnProject,
  ids.reviewApproveArchiveProject,
  ids.reviewApproveRemovalProject,
  ids.reviewApproveWorkspaceProject,
  ids.reviewApproveAccountProject,
  ids.reviewReturnCancelProject,
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
    ids.updateSameKeyProject,
    ids.updateDifferentKeyProject,
    ids.updateCancelProject,
    ids.updateBlockCancelProject,
    ids.updateEditProject,
    ids.updateArchiveProject,
    ids.updateAssigneeProject,
    ids.reviewSubmitSameKeyProject,
    ids.reviewSubmitDifferentKeyProject,
    ids.reviewSubmitCancelProject,
    ids.reviewSubmitProgressProject,
    ids.reviewSubmitEditProject,
    ids.reviewSubmitArchiveProject,
    ids.reviewSubmitAssigneeProject,
    ids.reviewSubmitRemovalProject,
    ids.reviewSubmitWorkspaceProject,
    ids.reviewSubmitAccountProject,
    ids.reviewApproveSameKeyProject,
    ids.reviewApproveDifferentKeyProject,
    ids.reviewApproveReturnProject,
    ids.reviewApproveArchiveProject,
    ids.reviewApproveRemovalProject,
    ids.reviewApproveWorkspaceProject,
    ids.reviewApproveAccountProject,
    ids.reviewReturnCancelProject,
  ].map((projectId) => [projectId, crypto.randomUUID()]),
)
const allUserIds = [
  ids.owner,
  ids.lead,
  ids.admin,
  ids.assigneeRemoval,
  ids.assigneeSuspension,
  ids.assigneeStable,
  ids.assigneeAccount,
  ids.reviewerSpecial,
  ids.reviewerWorkspace,
  ids.reviewerAccount,
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
      [ids.assigneeAccount, 'account assignee'],
      [ids.reviewerSpecial, 'special reviewer'],
      [ids.reviewerWorkspace, 'workspace reviewer'],
      [ids.reviewerAccount, 'account reviewer'],
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
      [ids.assigneeAccount, subjects.assigneeAccount],
      [ids.reviewerSpecial, subjects.reviewerSpecial],
      [ids.reviewerWorkspace, subjects.reviewerWorkspace],
      [ids.reviewerAccount, subjects.reviewerAccount],
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
        ids.updateArchiveProject,
        ids.reviewSubmitArchiveProject,
        ids.reviewApproveArchiveProject,
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
           ($1,$6,'member'),($1,$7,'member'),($1,$8,'member'),($1,$9,'member'),
           ($1,$10,'member'),($1,$11,'member'),($1,$12,'member'),($1,$13,'member')`,
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
          ids.assigneeAccount,
          ids.reviewerSpecial,
          ids.reviewerWorkspace,
          ids.reviewerAccount,
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
      const assigneeId =
        projectId === ids.reviewSubmitAccountProject
          ? ids.assigneeAccount
          : ids.assigneeStable
      const reviewerId =
        projectId === ids.reviewApproveWorkspaceProject
          ? ids.reviewerWorkspace
          : projectId === ids.reviewApproveAccountProject
            ? ids.reviewerAccount
            : [
                  ids.reviewApproveSameKeyProject,
                  ids.reviewApproveDifferentKeyProject,
                  ids.reviewApproveReturnProject,
                  ids.reviewApproveArchiveProject,
                  ids.reviewApproveRemovalProject,
                  ids.reviewReturnCancelProject,
                ].includes(projectId)
              ? ids.reviewerSpecial
              : ids.lead
      await client.query(
        `insert into public.tasks
           (id,project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
        [
          taskId,
          projectId,
          moduleByProject.get(projectId),
          'Fictional task before concurrent edit',
          assigneeId,
          reviewerId,
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
      'delete from public.task_updates where task_id in (select id from public.tasks where project_id = any($1::uuid[]))',
      [projectIds],
    )
    await client.query(
      'delete from public.task_reviews where task_id in (select id from public.tasks where project_id = any($1::uuid[]))',
      [projectIds],
    )
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
const createUpdateSql = `select public.create_task_update(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
) as task_update`
const submitReviewSql =
  'select public.submit_task_for_review($1,$2) as review_result'
const approveReviewSql =
  'select public.approve_task_review($1,$2) as review_result'
const returnReviewSql =
  'select public.return_task_review($1,$2,$3) as review_result'

const reviewProjectIds = [
  ids.reviewSubmitSameKeyProject,
  ids.reviewSubmitDifferentKeyProject,
  ids.reviewSubmitCancelProject,
  ids.reviewSubmitProgressProject,
  ids.reviewSubmitEditProject,
  ids.reviewSubmitArchiveProject,
  ids.reviewSubmitAssigneeProject,
  ids.reviewSubmitRemovalProject,
  ids.reviewSubmitWorkspaceProject,
  ids.reviewSubmitAccountProject,
  ids.reviewApproveSameKeyProject,
  ids.reviewApproveDifferentKeyProject,
  ids.reviewApproveReturnProject,
  ids.reviewApproveArchiveProject,
  ids.reviewApproveRemovalProject,
  ids.reviewApproveWorkspaceProject,
  ids.reviewApproveAccountProject,
  ids.reviewReturnCancelProject,
]

const pendingReviewProjectActors = new Map([
  [ids.reviewApproveSameKeyProject, subjects.reviewerSpecial],
  [ids.reviewApproveDifferentKeyProject, subjects.reviewerSpecial],
  [ids.reviewApproveReturnProject, subjects.reviewerSpecial],
  [ids.reviewApproveArchiveProject, subjects.reviewerSpecial],
  [ids.reviewApproveRemovalProject, subjects.reviewerSpecial],
  [ids.reviewApproveWorkspaceProject, subjects.reviewerWorkspace],
  [ids.reviewApproveAccountProject, subjects.reviewerAccount],
  [ids.reviewReturnCancelProject, subjects.reviewerSpecial],
])

function progressParams(
  taskId,
  completedContent,
  progress,
  idempotencyKey,
  { markBlocked = false, blockerReason = null } = {},
) {
  return [
    taskId,
    '2026-08-10',
    completedContent,
    progress,
    null,
    null,
    false,
    markBlocked,
    blockerReason,
    idempotencyKey,
  ]
}

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

async function prepareReviewFixtures() {
  for (const projectId of reviewProjectIds) {
    const taskId = taskByProject.get(projectId)
    const assigneeSubject =
      projectId === ids.reviewSubmitAccountProject
        ? subjects.assigneeAccount
        : subjects.assignee
    await runActor(assigneeSubject, startSql, [taskId, crypto.randomUUID()])
    await runActor(
      assigneeSubject,
      createUpdateSql,
      progressParams(
        taskId,
        'Fictional review-ready progress',
        100,
        crypto.randomUUID(),
      ),
    )
  }
  for (const projectId of pendingReviewProjectActors.keys()) {
    await runActor(subjects.assignee, submitReviewSql, [
      taskByProject.get(projectId),
      crypto.randomUUID(),
    ])
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
        `select id,transition_seq::integer as transition_seq,from_status,to_status,action,reason,
                actor_id,created_at::text
         from public.task_status_history
         where task_id=$1 order by transition_seq`,
        [taskId],
      )
    ).rows
  } finally {
    await client.end()
  }
}

async function progressState(taskId) {
  const client = await connect()
  try {
    const task = (
      await client.query(
        `select status,progress,blocker_reason,blocked_at,blocked_by,
                last_progress_at::text,last_progress_by,title,updated_at::text
         from public.tasks where id=$1`,
        [taskId],
      )
    ).rows[0]
    const updates = (
      await client.query(
        `select id,update_seq::integer,progress,is_blocked,block_transition_id,
                completed_content,created_at::text,created_by
         from public.task_updates where task_id=$1 order by update_seq`,
        [taskId],
      )
    ).rows
    const history = await transitionState(taskId)
    return { task, updates, history }
  } finally {
    await client.end()
  }
}

async function reviewState(taskId) {
  const client = await connect()
  try {
    const task = (
      await client.query(
        `select status,progress,title,assignee_id,reviewer_id,blocker_reason,
                blocked_at,blocked_by,completed_at::text,completed_by,
                last_progress_at::text,last_progress_by,updated_at::text
         from public.tasks where id=$1`,
        [taskId],
      )
    ).rows[0]
    const reviews = (
      await client.query(
        `select id,review_seq::integer,action,actor_id,from_status,to_status,
                return_reason,status_transition_id,created_at::text
         from public.task_reviews where task_id=$1 order by review_seq`,
        [taskId],
      )
    ).rows
    const updates = (
      await client.query(
        `select id,update_seq::integer,progress,created_at::text,created_by
         from public.task_updates where task_id=$1 order by update_seq`,
        [taskId],
      )
    ).rows
    const history = await transitionState(taskId)
    return { task, reviews, updates, history }
  } finally {
    await client.end()
  }
}

const reviewStatusAction = {
  submit: 'submit_review',
  approve: 'approve_review',
  return: 'return_review',
}

function isReviewStateConsistent(state) {
  const reviewIds = new Set()
  const transitionIds = new Set()
  const reviewsValid = state.reviews.every((review, index) => {
    const transition = state.history.find(
      (item) => item.id === review.status_transition_id,
    )
    const validReason =
      review.action === 'return'
        ? review.return_reason !== null && review.return_reason.length > 0
        : review.return_reason === null
    const valid =
      review.review_seq === index + 1 &&
      !reviewIds.has(review.id) &&
      !transitionIds.has(review.status_transition_id) &&
      transition?.action === reviewStatusAction[review.action] &&
      transition?.actor_id === review.actor_id &&
      transition?.from_status === review.from_status &&
      transition?.to_status === review.to_status &&
      transition?.reason === review.return_reason &&
      transition?.created_at === review.created_at &&
      validReason
    reviewIds.add(review.id)
    transitionIds.add(review.status_transition_id)
    return valid
  })
  const historyValid = state.history.every(
    (item, index) =>
      item.transition_seq === index + 1 &&
      (index === 0 || state.history[index - 1].to_status === item.from_status),
  )
  const updateTail = state.updates.at(-1)
  const progressValid =
    state.updates.length === 1 &&
    updateTail?.progress === state.task.progress &&
    updateTail?.created_at === state.task.last_progress_at &&
    updateTail?.created_by === state.task.last_progress_by
  const approve = [...state.reviews]
    .reverse()
    .find((review) => review.action === 'approve')
  const completionValid =
    state.task.status === 'completed'
      ? approve !== undefined &&
        state.task.completed_at === approve.created_at &&
        state.task.completed_by === approve.actor_id
      : state.task.completed_at === null && state.task.completed_by === null
  return (
    reviewsValid &&
    historyValid &&
    progressValid &&
    completionValid &&
    state.task.blocker_reason === null &&
    state.task.blocked_at === null &&
    state.task.blocked_by === null
  )
}

async function checkReviewTask(
  name,
  taskId,
  expectedStatus,
  expectedReviewActions,
  expectedHistoryActions,
  extra = () => true,
) {
  const state = await reviewState(taskId)
  check(
    `${name}: final task, progress, blocker, completion, ledgers and links are atomic`,
    state.task.status === expectedStatus &&
      state.reviews.map((row) => row.action).join(',') ===
        expectedReviewActions.join(',') &&
      state.history.map((row) => row.action).join(',') ===
        expectedHistoryActions.join(',') &&
      isReviewStateConsistent(state) &&
      extra(state),
  )
  return state
}

async function responsibilityState(projectId, userId) {
  const client = await connect()
  try {
    const result = await client.query(
      `select
         exists(select 1 from public.project_members where project_id=$1 and user_id=$2) as project_member,
         (select status::text from public.workspace_members where workspace_id=$3 and user_id=$2) as workspace_status,
         (select status::text from public.app_users where id=$2) as account_status`,
      [projectId, userId, ids.workspace],
    )
    return result.rows[0]
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
  await prepareReviewFixtures()

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

  const updateSameKeyTaskId = taskByProject.get(ids.updateSameKeyProject)
  await runActor(subjects.assignee, startSql, [
    updateSameKeyTaskId,
    crypto.randomUUID(),
  ])
  const updateSameKey = crypto.randomUUID()
  const updateSameKeyRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: createUpdateSql,
    firstParams: progressParams(
      updateSameKeyTaskId,
      'Fictional same-key progress',
      20,
      updateSameKey,
    ),
    secondActor: subjects.assignee,
    secondSql: createUpdateSql,
    secondParams: progressParams(
      updateSameKeyTaskId,
      'Fictional same-key progress',
      20,
      updateSameKey,
    ),
  })
  check(
    'same-key progress: duplicate genuinely waited on the task write chain',
    updateSameKeyRace.blockedObserved,
  )
  check(
    'same-key progress: both calls complete without a database error',
    updateSameKeyRace.secondError === null,
  )
  check(
    'same-key progress: first is new and second is an idempotent replay',
    updateSameKeyRace.firstResult.rows[0].task_update.was_existing === false &&
      updateSameKeyRace.secondResult?.rows[0].task_update.was_existing === true,
  )
  const updateSameKeyState = await progressState(updateSameKeyTaskId)
  check(
    'same-key progress: one ledger row and one progress value remain',
    updateSameKeyState.updates.length === 1 &&
      updateSameKeyState.updates[0].update_seq === 1 &&
      updateSameKeyState.task.progress === 20,
  )

  const updateDifferentKeyTaskId = taskByProject.get(
    ids.updateDifferentKeyProject,
  )
  await runActor(subjects.assignee, startSql, [
    updateDifferentKeyTaskId,
    crypto.randomUUID(),
  ])
  const updateDifferentKeyRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: createUpdateSql,
    firstParams: progressParams(
      updateDifferentKeyTaskId,
      'Fictional first concurrent progress',
      30,
      crypto.randomUUID(),
    ),
    secondActor: subjects.assignee,
    secondSql: createUpdateSql,
    secondParams: progressParams(
      updateDifferentKeyTaskId,
      'Fictional second concurrent progress',
      70,
      crypto.randomUUID(),
    ),
  })
  check(
    'different-key progress: second writer genuinely waited',
    updateDifferentKeyRace.blockedObserved,
  )
  check(
    'different-key progress: both serialized updates succeed',
    updateDifferentKeyRace.secondError === null,
  )
  const updateDifferentKeyState = await progressState(updateDifferentKeyTaskId)
  check(
    'different-key progress: sequence is unique and final task matches the linearized tail',
    updateDifferentKeyState.updates.length === 2 &&
      updateDifferentKeyState.updates[0].update_seq === 1 &&
      updateDifferentKeyState.updates[1].update_seq === 2 &&
      updateDifferentKeyState.task.progress === 70 &&
      updateDifferentKeyState.task.last_progress_at ===
        updateDifferentKeyState.updates[1].created_at &&
      updateDifferentKeyState.task.last_progress_by === ids.assigneeStable,
  )

  const updateCancelTaskId = taskByProject.get(ids.updateCancelProject)
  await runActor(subjects.assignee, startSql, [
    updateCancelTaskId,
    crypto.randomUUID(),
  ])
  const updateCancelRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: createUpdateSql,
    firstParams: progressParams(
      updateCancelTaskId,
      'Fictional progress before cancellation',
      45,
      crypto.randomUUID(),
    ),
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [updateCancelTaskId, crypto.randomUUID()],
  })
  check(
    'progress vs cancel: cancel genuinely waited behind progress',
    updateCancelRace.blockedObserved,
  )
  check(
    'progress vs cancel: both legal serial operations complete',
    updateCancelRace.secondError === null,
  )
  const updateCancelState = await progressState(updateCancelTaskId)
  check(
    'progress vs cancel: terminal task preserves committed progress without blocker residue',
    updateCancelState.task.status === 'cancelled' &&
      updateCancelState.task.progress === 45 &&
      updateCancelState.task.blocker_reason === null &&
      updateCancelState.updates.length === 1 &&
      updateCancelState.history.at(-1)?.to_status === 'cancelled',
  )

  const updateBlockCancelTaskId = taskByProject.get(
    ids.updateBlockCancelProject,
  )
  await runActor(subjects.assignee, startSql, [
    updateBlockCancelTaskId,
    crypto.randomUUID(),
  ])
  const updateBlockCancelRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: createUpdateSql,
    firstParams: progressParams(
      updateBlockCancelTaskId,
      'Fictional progress that detects a blocker',
      50,
      crypto.randomUUID(),
      {
        markBlocked: true,
        blockerReason: 'Fictional dependency during progress race',
      },
    ),
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [updateBlockCancelTaskId, crypto.randomUUID()],
  })
  check(
    'progress-with-block vs cancel: cancel genuinely waited',
    updateBlockCancelRace.blockedObserved,
  )
  check(
    'progress-with-block vs cancel: both serial operations complete without deadlock',
    updateBlockCancelRace.secondError === null,
  )
  const updateBlockCancelState = await progressState(updateBlockCancelTaskId)
  check(
    'progress-with-block vs cancel: update links the real block transition and final cancel clears current blocker',
    updateBlockCancelState.task.status === 'cancelled' &&
      updateBlockCancelState.task.progress === 50 &&
      updateBlockCancelState.task.blocker_reason === null &&
      updateBlockCancelState.updates.length === 1 &&
      updateBlockCancelState.updates[0].is_blocked === true &&
      updateBlockCancelState.updates[0].block_transition_id !== null &&
      updateBlockCancelState.history.length === 3 &&
      updateBlockCancelState.history[1].action === 'block' &&
      updateBlockCancelState.history[2].action === 'cancel',
  )

  const updateEditTaskId = taskByProject.get(ids.updateEditProject)
  await runActor(subjects.assignee, startSql, [
    updateEditTaskId,
    crypto.randomUUID(),
  ])
  const updateEditVersion = await taskVersion(updateEditTaskId)
  const updateEditRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: createUpdateSql,
    firstParams: progressParams(
      updateEditTaskId,
      'Fictional progress before stale metadata edit',
      65,
      crypto.randomUUID(),
    ),
    secondActor: subjects.owner,
    secondSql: updateSql,
    secondParams: [
      ids.updateEditProject,
      updateEditTaskId,
      moduleByProject.get(ids.updateEditProject),
      'Stale metadata after progress',
      ids.assigneeStable,
      [],
      ids.lead,
      updateEditVersion,
    ],
  })
  check(
    'progress vs metadata: stale edit genuinely waited on project lock',
    updateEditRace.blockedObserved,
  )
  check(
    'progress vs metadata: old optimistic version is rejected',
    updateEditRace.secondError?.code === '40001',
  )
  const updateEditState = await progressState(updateEditTaskId)
  check(
    'progress vs metadata: progress wins and stale title is not written',
    updateEditState.task.progress === 65 &&
      updateEditState.task.title === 'Fictional task before concurrent edit' &&
      updateEditState.updates.length === 1,
  )

  const updateArchiveTaskId = taskByProject.get(ids.updateArchiveProject)
  await runActor(subjects.assignee, startSql, [
    updateArchiveTaskId,
    crypto.randomUUID(),
  ])
  const updateArchiveVersion = await projectVersion(ids.updateArchiveProject)
  const updateArchiveRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1,$2)',
    firstParams: [ids.updateArchiveProject, updateArchiveVersion],
    secondActor: subjects.assignee,
    secondSql: createUpdateSql,
    secondParams: progressParams(
      updateArchiveTaskId,
      'Denied progress after archive',
      80,
      crypto.randomUUID(),
    ),
  })
  check(
    'archive vs progress: progress genuinely waited on project lock',
    updateArchiveRace.blockedObserved,
  )
  check(
    'archive vs progress: archived project rejects the later update',
    updateArchiveRace.secondError?.code === '55000',
  )
  const updateArchiveState = await progressState(updateArchiveTaskId)
  check(
    'archive vs progress: rejected update leaves progress ledger empty',
    updateArchiveState.task.progress === 0 &&
      updateArchiveState.task.last_progress_at === null &&
      updateArchiveState.updates.length === 0 &&
      (await projectStatus(ids.updateArchiveProject)) === 'archived',
  )

  const updateAssigneeTaskId = taskByProject.get(ids.updateAssigneeProject)
  await runActor(subjects.assignee, startSql, [
    updateAssigneeTaskId,
    crypto.randomUUID(),
  ])
  const updateAssigneeVersion = await taskVersion(updateAssigneeTaskId)
  const updateAssigneeRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: updateSql,
    firstParams: [
      ids.updateAssigneeProject,
      updateAssigneeTaskId,
      moduleByProject.get(ids.updateAssigneeProject),
      'Fictional reassigned task',
      ids.collaboratorB,
      [],
      ids.lead,
      updateAssigneeVersion,
    ],
    secondActor: subjects.assignee,
    secondSql: createUpdateSql,
    secondParams: progressParams(
      updateAssigneeTaskId,
      'Denied stale assignee progress',
      90,
      crypto.randomUUID(),
    ),
  })
  check(
    'assignee change vs progress: stale assignee update genuinely waited',
    updateAssigneeRace.blockedObserved,
  )
  check(
    'assignee change vs progress: old assignee is rejected after lock reauthorization',
    updateAssigneeRace.secondError?.code === '42501',
  )
  const updateAssigneeState = await progressState(updateAssigneeTaskId)
  check(
    'assignee change vs progress: reassignment commits with no stale progress residue',
    updateAssigneeState.task.title === 'Fictional reassigned task' &&
      updateAssigneeState.task.progress === 0 &&
      updateAssigneeState.updates.length === 0,
  )

  const submitSameTaskId = taskByProject.get(ids.reviewSubmitSameKeyProject)
  const submitSameKey = crypto.randomUUID()
  const submitSameRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitSameTaskId, submitSameKey],
    secondActor: subjects.assignee,
    secondSql: submitReviewSql,
    secondParams: [submitSameTaskId, submitSameKey],
  })
  check(
    'same-key submit review: replay genuinely waited on the project-first lock',
    submitSameRace.blockedObserved,
  )
  check(
    'same-key submit review: first write and replay both return without deadlock',
    submitSameRace.secondError === null &&
      submitSameRace.firstResult.rows[0].review_result.was_existing === false &&
      submitSameRace.secondResult?.rows[0].review_result.was_existing === true,
  )
  await checkReviewTask(
    'same-key submit review',
    submitSameTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )

  const submitDifferentTaskId = taskByProject.get(
    ids.reviewSubmitDifferentKeyProject,
  )
  const submitDifferentRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitDifferentTaskId, crypto.randomUUID()],
    secondActor: subjects.assignee,
    secondSql: submitReviewSql,
    secondParams: [submitDifferentTaskId, crypto.randomUUID()],
  })
  check(
    'different-key submit review: losing intent genuinely waited',
    submitDifferentRace.blockedObserved,
  )
  check(
    'different-key submit review: later intent is rejected after re-read',
    submitDifferentRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'different-key submit review',
    submitDifferentTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )

  const submitCancelTaskId = taskByProject.get(ids.reviewSubmitCancelProject)
  const submitCancelRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitCancelTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [submitCancelTaskId, crypto.randomUUID()],
  })
  check(
    'submit review vs cancel: cancel genuinely waited',
    submitCancelRace.blockedObserved,
  )
  check(
    'submit review vs cancel: generic cancel cannot mutate pending review',
    submitCancelRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'submit review vs cancel',
    submitCancelTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )

  const submitProgressTaskId = taskByProject.get(
    ids.reviewSubmitProgressProject,
  )
  const submitProgressRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitProgressTaskId, crypto.randomUUID()],
    secondActor: subjects.assignee,
    secondSql: createUpdateSql,
    secondParams: progressParams(
      submitProgressTaskId,
      'Denied stale progress after submit review',
      100,
      crypto.randomUUID(),
    ),
  })
  check(
    'submit review vs progress: progress genuinely waited',
    submitProgressRace.blockedObserved,
  )
  check(
    'submit review vs progress: pending review rejects stale progress',
    submitProgressRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'submit review vs progress',
    submitProgressTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )

  const submitEditTaskId = taskByProject.get(ids.reviewSubmitEditProject)
  const submitEditVersion = await taskVersion(submitEditTaskId)
  const submitEditRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitEditTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: updateSql,
    secondParams: [
      ids.reviewSubmitEditProject,
      submitEditTaskId,
      moduleByProject.get(ids.reviewSubmitEditProject),
      'Denied stale metadata after submit review',
      ids.assigneeStable,
      [],
      ids.lead,
      submitEditVersion,
    ],
  })
  check(
    'submit review vs metadata: stale edit genuinely waited',
    submitEditRace.blockedObserved,
  )
  check(
    'submit review vs metadata: stale optimistic edit is rejected',
    ['40001', '55000'].includes(submitEditRace.secondError?.code),
  )
  await checkReviewTask(
    'submit review vs metadata',
    submitEditTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
    (state) => state.task.title === 'Fictional task before concurrent edit',
  )

  const submitArchiveTaskId = taskByProject.get(ids.reviewSubmitArchiveProject)
  const submitArchiveVersion = await projectVersion(
    ids.reviewSubmitArchiveProject,
  )
  const submitArchiveRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1,$2)',
    firstParams: [ids.reviewSubmitArchiveProject, submitArchiveVersion],
    secondActor: subjects.assignee,
    secondSql: submitReviewSql,
    secondParams: [submitArchiveTaskId, crypto.randomUUID()],
  })
  check(
    'archive vs submit review: submit genuinely waited',
    submitArchiveRace.blockedObserved,
  )
  check(
    'archive vs submit review: archived project rejects review mutation',
    submitArchiveRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'archive vs submit review',
    submitArchiveTaskId,
    'in_progress',
    [],
    ['start'],
    () => true,
  )
  check(
    'archive vs submit review: project archive is the only committed competing mutation',
    (await projectStatus(ids.reviewSubmitArchiveProject)) === 'archived',
  )

  const submitAssigneeTaskId = taskByProject.get(
    ids.reviewSubmitAssigneeProject,
  )
  const submitAssigneeVersion = await taskVersion(submitAssigneeTaskId)
  const submitAssigneeRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: updateSql,
    firstParams: [
      ids.reviewSubmitAssigneeProject,
      submitAssigneeTaskId,
      moduleByProject.get(ids.reviewSubmitAssigneeProject),
      'Fictional reassignment before submit review',
      ids.collaboratorB,
      [],
      ids.lead,
      submitAssigneeVersion,
    ],
    secondActor: subjects.assignee,
    secondSql: submitReviewSql,
    secondParams: [submitAssigneeTaskId, crypto.randomUUID()],
  })
  check(
    'assignee replacement vs submit review: old assignee genuinely waited',
    submitAssigneeRace.blockedObserved,
  )
  check(
    'assignee replacement vs submit review: old actor is rejected after lock reauthorization',
    submitAssigneeRace.secondError?.code === '42501',
  )
  await checkReviewTask(
    'assignee replacement vs submit review',
    submitAssigneeTaskId,
    'in_progress',
    [],
    ['start'],
    (state) =>
      state.task.assignee_id === ids.collaboratorB &&
      state.task.title === 'Fictional reassignment before submit review',
  )

  const submitRemovalTaskId = taskByProject.get(ids.reviewSubmitRemovalProject)
  const submitRemovalRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitRemovalTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: 'select * from public.remove_project_member($1,$2)',
    secondParams: [ids.reviewSubmitRemovalProject, ids.assigneeStable],
  })
  check(
    'submit review vs assignee removal: removal genuinely waited',
    submitRemovalRace.blockedObserved,
  )
  check(
    'submit review vs assignee removal: active pending responsibility blocks removal',
    submitRemovalRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'submit review vs assignee removal',
    submitRemovalTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )
  check(
    'submit review vs assignee removal: rejected removal leaves membership active',
    (
      await responsibilityState(
        ids.reviewSubmitRemovalProject,
        ids.assigneeStable,
      )
    ).project_member === true,
  )

  const submitWorkspaceTaskId = taskByProject.get(
    ids.reviewSubmitWorkspaceProject,
  )
  const submitWorkspaceRace = await lockWaitRace({
    firstActor: subjects.assignee,
    firstSql: submitReviewSql,
    firstParams: [submitWorkspaceTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: 'select * from public.set_workspace_member_status($1,$2,$3)',
    secondParams: [ids.workspace, ids.assigneeStable, 'suspended'],
  })
  check(
    'submit review vs workspace suspension: suspension genuinely waited',
    submitWorkspaceRace.blockedObserved,
  )
  check(
    'submit review vs workspace suspension: pending responsibility rejects suspension',
    submitWorkspaceRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'submit review vs workspace suspension',
    submitWorkspaceTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )
  check(
    'submit review vs workspace suspension: rejected suspension leaves actor active',
    (
      await responsibilityState(
        ids.reviewSubmitWorkspaceProject,
        ids.assigneeStable,
      )
    ).workspace_status === 'active',
  )

  const submitAccountTaskId = taskByProject.get(ids.reviewSubmitAccountProject)
  const submitAccountRace = await lockWaitRace({
    firstActor: subjects.assigneeAccount,
    firstSql: submitReviewSql,
    firstParams: [submitAccountTaskId, crypto.randomUUID()],
    secondActor: null,
    secondSql:
      "update public.app_users set status='suspended',disabled_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 returning id",
    secondParams: [ids.assigneeAccount],
  })
  check(
    'submit review vs account suspension: account mutation genuinely waited',
    submitAccountRace.blockedObserved,
  )
  check(
    'submit review vs account suspension: pending responsibility rejects suspension',
    submitAccountRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'submit review vs account suspension',
    submitAccountTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )
  check(
    'submit review vs account suspension: rejected account mutation rolls back',
    (
      await responsibilityState(
        ids.reviewSubmitAccountProject,
        ids.assigneeAccount,
      )
    ).account_status === 'active',
  )

  const approveSameTaskId = taskByProject.get(ids.reviewApproveSameKeyProject)
  const approveSameKey = crypto.randomUUID()
  const approveSameRace = await lockWaitRace({
    firstActor: subjects.reviewerSpecial,
    firstSql: approveReviewSql,
    firstParams: [approveSameTaskId, approveSameKey],
    secondActor: subjects.reviewerSpecial,
    secondSql: approveReviewSql,
    secondParams: [approveSameTaskId, approveSameKey],
  })
  check(
    'same-key approve review: replay genuinely waited',
    approveSameRace.blockedObserved,
  )
  check(
    'same-key approve review: exact replay returns the existing review without deadlock',
    approveSameRace.secondError === null &&
      approveSameRace.firstResult.rows[0].review_result.was_existing ===
        false &&
      approveSameRace.secondResult?.rows[0].review_result.was_existing === true,
  )
  await checkReviewTask(
    'same-key approve review',
    approveSameTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )

  const approveDifferentTaskId = taskByProject.get(
    ids.reviewApproveDifferentKeyProject,
  )
  const approveDifferentRace = await lockWaitRace({
    firstActor: subjects.reviewerSpecial,
    firstSql: approveReviewSql,
    firstParams: [approveDifferentTaskId, crypto.randomUUID()],
    secondActor: subjects.reviewerSpecial,
    secondSql: approveReviewSql,
    secondParams: [approveDifferentTaskId, crypto.randomUUID()],
  })
  check(
    'different-key approve review: losing intent genuinely waited',
    approveDifferentRace.blockedObserved,
  )
  check(
    'different-key approve review: later approval is rejected after completion',
    approveDifferentRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'different-key approve review',
    approveDifferentTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )

  const approveReturnTaskId = taskByProject.get(ids.reviewApproveReturnProject)
  const approveReturnRace = await lockWaitRace({
    firstActor: subjects.reviewerSpecial,
    firstSql: approveReviewSql,
    firstParams: [approveReturnTaskId, crypto.randomUUID()],
    secondActor: subjects.reviewerSpecial,
    secondSql: returnReviewSql,
    secondParams: [
      approveReturnTaskId,
      'Fictional losing return reason',
      crypto.randomUUID(),
    ],
  })
  check(
    'approve vs return review: return genuinely waited',
    approveReturnRace.blockedObserved,
  )
  check(
    'approve vs return review: completed task rejects the competing decision',
    approveReturnRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'approve vs return review',
    approveReturnTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )

  const approveArchiveTaskId = taskByProject.get(
    ids.reviewApproveArchiveProject,
  )
  const approveArchiveVersion = await projectVersion(
    ids.reviewApproveArchiveProject,
  )
  const approveArchiveRace = await lockWaitRace({
    firstActor: subjects.owner,
    firstSql: 'select * from public.archive_project($1,$2)',
    firstParams: [ids.reviewApproveArchiveProject, approveArchiveVersion],
    secondActor: subjects.reviewerSpecial,
    secondSql: approveReviewSql,
    secondParams: [approveArchiveTaskId, crypto.randomUUID()],
  })
  check(
    'archive vs approve review: approval genuinely waited',
    approveArchiveRace.blockedObserved,
  )
  check(
    'archive vs approve review: archived project rejects approval',
    approveArchiveRace.secondError?.code === '55000',
  )
  await checkReviewTask(
    'archive vs approve review',
    approveArchiveTaskId,
    'pending_review',
    ['submit'],
    ['start', 'submit_review'],
  )
  check(
    'archive vs approve review: project archive persists without completion residue',
    (await projectStatus(ids.reviewApproveArchiveProject)) === 'archived',
  )

  const approveRemovalTaskId = taskByProject.get(
    ids.reviewApproveRemovalProject,
  )
  const approveRemovalRace = await lockWaitRace({
    firstActor: subjects.reviewerSpecial,
    firstSql: approveReviewSql,
    firstParams: [approveRemovalTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: 'select * from public.remove_project_member($1,$2)',
    secondParams: [ids.reviewApproveRemovalProject, ids.reviewerSpecial],
  })
  check(
    'approve review vs reviewer removal: removal genuinely waited',
    approveRemovalRace.blockedObserved,
  )
  check(
    'approve review vs reviewer removal: both serialized operations complete',
    approveRemovalRace.secondError === null,
  )
  await checkReviewTask(
    'approve review vs reviewer removal',
    approveRemovalTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )
  check(
    'approve review vs reviewer removal: terminal responsibility permits removal',
    (
      await responsibilityState(
        ids.reviewApproveRemovalProject,
        ids.reviewerSpecial,
      )
    ).project_member === false,
  )

  const approveWorkspaceTaskId = taskByProject.get(
    ids.reviewApproveWorkspaceProject,
  )
  const approveWorkspaceRace = await lockWaitRace({
    firstActor: subjects.reviewerWorkspace,
    firstSql: approveReviewSql,
    firstParams: [approveWorkspaceTaskId, crypto.randomUUID()],
    secondActor: subjects.owner,
    secondSql: 'select * from public.set_workspace_member_status($1,$2,$3)',
    secondParams: [ids.workspace, ids.reviewerWorkspace, 'suspended'],
  })
  check(
    'approve review vs reviewer workspace suspension: suspension genuinely waited',
    approveWorkspaceRace.blockedObserved,
  )
  check(
    'approve review vs reviewer workspace suspension: both serialized operations complete',
    approveWorkspaceRace.secondError === null,
  )
  await checkReviewTask(
    'approve review vs reviewer workspace suspension',
    approveWorkspaceTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )
  check(
    'approve review vs reviewer workspace suspension: terminal responsibility permits suspension',
    (
      await responsibilityState(
        ids.reviewApproveWorkspaceProject,
        ids.reviewerWorkspace,
      )
    ).workspace_status === 'suspended',
  )

  const approveAccountTaskId = taskByProject.get(
    ids.reviewApproveAccountProject,
  )
  const approveAccountRace = await lockWaitRace({
    firstActor: subjects.reviewerAccount,
    firstSql: approveReviewSql,
    firstParams: [approveAccountTaskId, crypto.randomUUID()],
    secondActor: null,
    secondSql:
      "update public.app_users set status='suspended',disabled_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 returning id",
    secondParams: [ids.reviewerAccount],
  })
  check(
    'approve review vs reviewer account suspension: suspension genuinely waited',
    approveAccountRace.blockedObserved,
  )
  check(
    'approve review vs reviewer account suspension: both serialized operations complete',
    approveAccountRace.secondError === null,
  )
  await checkReviewTask(
    'approve review vs reviewer account suspension',
    approveAccountTaskId,
    'completed',
    ['submit', 'approve'],
    ['start', 'submit_review', 'approve_review'],
  )
  check(
    'approve review vs reviewer account suspension: terminal responsibility permits suspension',
    (
      await responsibilityState(
        ids.reviewApproveAccountProject,
        ids.reviewerAccount,
      )
    ).account_status === 'suspended',
  )

  const returnCancelTaskId = taskByProject.get(ids.reviewReturnCancelProject)
  const returnCancelRace = await lockWaitRace({
    firstActor: subjects.reviewerSpecial,
    firstSql: returnReviewSql,
    firstParams: [
      returnCancelTaskId,
      'Fictional return before cancellation',
      crypto.randomUUID(),
    ],
    secondActor: subjects.owner,
    secondSql: cancelSql,
    secondParams: [returnCancelTaskId, crypto.randomUUID()],
  })
  check(
    'return review vs cancel: cancel genuinely waited',
    returnCancelRace.blockedObserved,
  )
  check(
    'return review vs cancel: both legal serialized operations complete without deadlock',
    returnCancelRace.secondError === null,
  )
  await checkReviewTask(
    'return review vs cancel',
    returnCancelTaskId,
    'cancelled',
    ['submit', 'return'],
    ['start', 'submit_review', 'return_review', 'cancel'],
    (state) =>
      state.reviews[1].return_reason === 'Fictional return before cancellation',
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
