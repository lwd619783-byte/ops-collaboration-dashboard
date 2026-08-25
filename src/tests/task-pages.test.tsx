import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { Project, ProjectModule } from '@/features/projects'
import {
  TaskContext,
  type TaskContextValue,
} from '@/features/tasks/TaskContext'
import type {
  Task,
  TaskAssignmentCandidate,
  TaskProgressUpdate,
  TaskReview,
  TaskReviewResult,
} from '@/features/tasks'
import { TASK_STATE_CONSISTENCY_MAX_ATTEMPTS } from '@/features/tasks'
import type {
  TaskStatusHistoryItem,
  TaskTransitionResult,
} from '@/features/tasks'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import type { WorkspaceRole } from '@/features/workspaces'
import { EditTaskPage } from '@/pages/EditTaskPage'
import { NewTaskPage } from '@/pages/NewTaskPage'
import { TaskDetailPage } from '@/pages/TaskDetailPage'
import {
  fictionalAppUser,
  fictionalProfile,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const MODULE_ID = 'bbbbbbbb-1111-4111-8111-111111111111'
const TASK_ID = 'cccccccc-1111-4111-8111-111111111111'
const SECOND_TASK_ID = 'cccccccc-2222-4222-8222-222222222222'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_REVIEWER_ID = '33333333-3333-4333-8333-333333333333'
const SUBMIT_REVIEW_ID = 'abababab-2222-4222-8222-222222222222'
const APPROVE_REVIEW_ID = 'abababab-3333-4333-8333-333333333333'

const project: Project = {
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '虚构任务项目',
  description: null,
  project_type: 'operations',
  status: 'active',
  owner_id: FICTIONAL_APP_USER_ID,
  owner_display_name: '虚构负责人',
  lead_id: null,
  lead_display_name: null,
  start_date: null,
  due_date: null,
  created_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-09T01:00:00+00:00',
  updated_at: '2026-08-09T01:00:00+00:00',
  archived_at: null,
}

const projectModule: ProjectModule = {
  module_id: MODULE_ID,
  project_id: PROJECT_ID,
  name: '虚构任务模块',
  sort_position: 0,
  created_by: FICTIONAL_APP_USER_ID,
  updated_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-09T01:00:00+00:00',
  updated_at: '2026-08-09T01:00:00+00:00',
}

const candidates: TaskAssignmentCandidate[] = [
  {
    project_id: PROJECT_ID,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    app_user_id: FICTIONAL_APP_USER_ID,
    display_name: '虚构负责人',
    project_role: 'owner',
    can_hold_responsibility: true,
  },
  {
    project_id: PROJECT_ID,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    app_user_id: MEMBER_ID,
    display_name: '虚构成员',
    project_role: 'member',
    can_hold_responsibility: true,
  },
]

const task: Task = {
  task_id: TASK_ID,
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  module_id: MODULE_ID,
  module_name: projectModule.name,
  title: '虚构深链任务甲',
  description: '虚构任务说明',
  acceptance_criteria: '虚构验收标准',
  assignee_id: FICTIONAL_APP_USER_ID,
  assignee_display_name: '虚构负责人',
  collaborators: [],
  reviewer_id: MEMBER_ID,
  reviewer_display_name: '虚构成员',
  priority: 'medium',
  start_date: null,
  due_date: null,
  estimated_hours: null,
  workload_level: 'm',
  visibility: 'project',
  visibility_users: [],
  status: 'todo',
  progress: 0,
  last_progress_at: null,
  last_progress_by: null,
  last_progress_by_display_name: null,
  completed_at: null,
  completed_by: null,
  completed_by_display_name: null,
  blocker_reason: null,
  blocked_at: null,
  blocked_by: null,
  blocked_by_display_name: null,
  created_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-09T01:00:00+00:00',
  updated_by: FICTIONAL_APP_USER_ID,
  updated_at: '2026-08-09T01:00:00+00:00',
}

function transitionResult(
  _nextTask: Task,
  transition: TaskTransitionResult['transition'],
): TaskTransitionResult {
  return { transition, was_existing: false }
}

function historyItem(
  transition: TaskTransitionResult['transition'],
  reason: string | null = null,
): TaskStatusHistoryItem {
  return {
    ...transition,
    reason,
    actor_id: FICTIONAL_APP_USER_ID,
    actor_display_name: '虚构负责人',
  }
}

function progressItem(
  overrides: Partial<TaskProgressUpdate> = {},
): TaskProgressUpdate {
  return {
    update_id: 'abababab-1111-4111-8111-111111111111',
    task_id: TASK_ID,
    sequence: 1,
    record_date: '2026-08-10',
    completed_content: 'Fictional completed work',
    progress: 40,
    issues: null,
    next_steps: 'Fictional next step',
    needs_assistance: true,
    is_blocked: false,
    block_transition_id: null,
    created_by: FICTIONAL_APP_USER_ID,
    created_by_display_name: '虚构负责人',
    created_at: '2026-08-10T02:00:00+00:00',
    ...overrides,
  }
}

function reviewItem(overrides: Partial<TaskReview> = {}): TaskReview {
  return {
    review_id: SUBMIT_REVIEW_ID,
    task_id: TASK_ID,
    sequence: 1,
    action: 'submit',
    actor_id: FICTIONAL_APP_USER_ID,
    actor_display_name: 'Fictional assignee',
    from_status: 'in_progress',
    to_status: 'pending_review',
    return_reason: null,
    status_transition_id: 'abababab-4444-4444-8444-444444444444',
    created_at: '2026-08-10T03:00:00+00:00',
    ...overrides,
  }
}

function authValue(): AuthContextValue {
  return {
    status: 'authenticated_authorized',
    appUser: fictionalAppUser,
    profile: fictionalProfile,
    authError: null,
    profileMissing: false,
    configState: null,
    isRecoverySession: false,
    activationPasswordSet: false,
    notice: null,
    clearNotice: vi.fn(),
    signIn: vi.fn(async () => ({ ok: true as const, data: undefined })),
    signOut: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    })),
    updatePassword: vi.fn(async () => ({ ok: true as const, data: undefined })),
    setInitialPassword: vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    })),
    completeAccountActivationSignOut: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => ({
      ok: true as const,
      data: fictionalProfile,
    })),
    refreshProfile: vi.fn(async () => undefined),
    retryAuthCheck: vi.fn(),
  }
}

function workspaceValue(role: WorkspaceRole = 'owner'): WorkspaceContextValue {
  return {
    status: 'ready',
    workspaces: [],
    currentWorkspace: {
      workspace_id: FICTIONAL_WORKSPACE_ID,
      workspace_name: '虚构协同空间',
      role,
      status: 'active',
      joined_at: '2026-08-01T00:00:00+00:00',
    },
    pendingInvitations: [],
    error: null,
    refresh: vi.fn(async () => undefined),
    listMembers: vi.fn(async () => ({ ok: true as const, data: [] })),
    inviteMember: vi.fn(async () => ({ ok: true as const, data: undefined })),
    setMemberRole: vi.fn(async () => ({ ok: true as const, data: undefined })),
    setMemberStatus: vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    })),
    acceptInvitation: vi.fn(async () => ({
      ok: true as const,
      data: { alreadyAccepted: false },
    })),
  }
}

function projectValue(
  overrides: Partial<ProjectContextValue> = {},
): ProjectContextValue {
  const mutation = { ...project, changed: true }
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [project] })),
    get: vi.fn(async () => ({ ok: true as const, data: project })),
    create: vi.fn(async () => ({ ok: true as const, data: project })),
    update: vi.fn(async () => ({ ok: true as const, data: project })),
    archive: vi.fn(async () => ({ ok: true as const, data: project })),
    listMembers: vi.fn(async () => ({ ok: true as const, data: [] })),
    listModules: vi.fn(async () => ({
      ok: true as const,
      data: [projectModule],
    })),
    addModule: vi.fn(async () => ({ ok: true as const, data: [] })),
    renameModule: vi.fn(async () => ({ ok: true as const, data: [] })),
    reorderModules: vi.fn(async () => ({ ok: true as const, data: [] })),
    deleteModule: vi.fn(async () => ({ ok: true as const, data: [] })),
    listMemberCandidates: vi.fn(async () => ({ ok: true as const, data: [] })),
    addMember: vi.fn(async () => ({ ok: true as const, data: mutation })),
    setMemberRole: vi.fn(async () => ({ ok: true as const, data: mutation })),
    removeMember: vi.fn(async () => ({ ok: true as const, data: mutation })),
    setLead: vi.fn(async () => ({ ok: true as const, data: mutation })),
    clearLead: vi.fn(async () => ({ ok: true as const, data: mutation })),
    transferOwner: vi.fn(async () => ({ ok: true as const, data: mutation })),
    ...overrides,
  }
}

function taskValue(
  overrides: Partial<TaskContextValue> = {},
): TaskContextValue {
  return {
    get: vi.fn(async () => ({ ok: true as const, data: task })),
    list: vi.fn(async () => ({ ok: true as const, data: [] })),
    listMine: vi.fn(async () => ({ ok: true as const, data: [] })),
    listCandidates: vi.fn(async () => ({
      ok: true as const,
      data: candidates,
    })),
    create: vi.fn(async () => ({ ok: true as const, data: task })),
    update: vi.fn(async () => ({ ok: true as const, data: task })),
    start: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    block: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    resume: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    cancel: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    listStatusHistory: vi.fn(async () => ({ ok: true as const, data: [] })),
    listUpdates: vi.fn(async () => ({ ok: true as const, data: [] })),
    listReviews: vi.fn(async () => ({ ok: true as const, data: [] })),
    createProgressUpdate: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    submitReview: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    approveReview: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    returnReview: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    ...overrides,
  }
}

function renderTaskRoutes(
  initialEntry: string,
  routes: React.ReactNode,
  projects = projectValue(),
  tasks = taskValue(),
  workspaceContext = workspaceValue(),
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthContext.Provider value={authValue()}>
        <WorkspaceContext.Provider value={workspaceContext}>
          <ProjectContext.Provider value={projects}>
            <TaskContext.Provider value={tasks}>
              <Routes>{routes}</Routes>
            </TaskContext.Provider>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('任务页面', () => {
  it('创建页加载可信候选并在成功后进入稳定任务深链', async () => {
    const user = userEvent.setup()
    const tasks = taskValue()
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/new`,
      <>
        <Route
          path="/projects/:projectId/tasks/new"
          element={<NewTaskPage />}
        />
        <Route
          path="/projects/:projectId/tasks/:taskId"
          element={<p>创建后任务详情</p>}
        />
      </>,
      projectValue(),
      tasks,
    )

    expect(
      await screen.findByRole('heading', { name: '创建项目任务' }),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText(/任务标题/), '虚构创建任务')
    await user.selectOptions(screen.getByLabelText(/项目模块/), MODULE_ID)
    await user.selectOptions(
      screen.getByLabelText(/主要负责人/),
      FICTIONAL_APP_USER_ID,
    )
    await user.selectOptions(screen.getByLabelText(/验收人/), MEMBER_ID)
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByText('创建后任务详情')).toBeInTheDocument()
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        title: '虚构创建任务',
        idempotencyKey: expect.any(String),
      }),
    )
  })

  it('编辑页从 deep link 回填数据并携带 expectedUpdatedAt 保存', async () => {
    const user = userEvent.setup()
    const tasks = taskValue({
      update: vi.fn(async (input) => ({
        ok: true as const,
        data: { ...task, title: input.title },
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}/edit`,
      <>
        <Route
          path="/projects/:projectId/tasks/:taskId/edit"
          element={<EditTaskPage />}
        />
        <Route
          path="/projects/:projectId/tasks/:taskId"
          element={<p>保存后任务详情</p>}
        />
      </>,
      projectValue(),
      tasks,
    )

    const title = await screen.findByDisplayValue(task.title)
    await user.clear(title)
    await user.type(title, '虚构更新任务')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByText('保存后任务详情')).toBeInTheDocument()
    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        expectedUpdatedAt: task.updated_at,
        title: '虚构更新任务',
      }),
    )
  })

  it('详情 deep link 展示安全投影和管理者编辑入口', async () => {
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: task.title }),
    ).toBeInTheDocument()
    expect(screen.getByText(task.assignee_display_name)).toBeInTheDocument()
    expect(screen.getByText(task.acceptance_criteria ?? '')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '编辑任务' })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}/edit`,
    )
    expect(screen.getByRole('button', { name: '开始任务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消任务' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '状态历史' }),
    ).toBeInTheDocument()
    expect(screen.getByText('还没有进展记录。')).toBeInTheDocument()
  })

  it('todo assignee 可开始但非管理者不能取消', async () => {
    const memberProject = {
      ...project,
      owner_id: MEMBER_ID,
      owner_display_name: '虚构其他负责人',
    }
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: memberProject })),
      }),
      taskValue(),
      workspaceValue('member'),
    )

    expect(
      await screen.findByRole('button', { name: '开始任务' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '取消任务' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/今日完成内容/)).not.toBeInTheDocument()
    expect(
      screen.getByText('请先开始任务，进入进行中后再记录执行进展。'),
    ).toBeInTheDocument()
  })

  it('in_progress assignee 提交进展后原子刷新进度、最新时间和时间线', async () => {
    const user = userEvent.setup()
    const startTransition = {
      transition_id: 'acacacac-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const update = progressItem()
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const progressedTask: Task = {
      ...inProgressTask,
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: inProgressTask })
        .mockResolvedValueOnce({ ok: true, data: progressedTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValue({ ok: true, data: [historyItem(startTransition)] }),
      listUpdates: vi
        .fn<TaskContextValue['listUpdates']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [update] }),
      createProgressUpdate: vi.fn(async () => ({
        ok: true as const,
        data: { task: progressedTask, update, was_existing: false },
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.type(
      await screen.findByLabelText(/今日完成内容/),
      'Fictional completed work',
    )
    const progressInput = screen.getByLabelText(/当前完成比例/)
    await user.clear(progressInput)
    await user.type(progressInput, '40')
    await user.type(screen.getByLabelText('下一步计划'), 'Fictional next step')
    await user.click(screen.getByLabelText('需要协助'))
    await user.click(screen.getByRole('button', { name: '提交进展' }))

    expect(tasks.createProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        progress: 40,
        completedContent: 'Fictional completed work',
        nextSteps: 'Fictional next step',
        needsAssistance: true,
        markBlocked: false,
        idempotencyKey: expect.any(String),
      }),
    )
    expect(
      await screen.findByRole('progressbar', { name: '当前任务进度 40%' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fictional completed work')).toBeInTheDocument()
    expect(screen.getAllByText('需要协助')).toHaveLength(2)
    expect(screen.getAllByText('#1')).toHaveLength(2)
    expect(screen.getByLabelText(/今日完成内容/)).toHaveValue('')
    expect(screen.getByLabelText(/当前完成比例/)).toHaveValue(40)
  })

  it('进展网络重试保留 key，非重试错误后生成新业务意图 key', async () => {
    const user = userEvent.setup()
    const startTransition = {
      transition_id: 'acacacac-2222-4222-8222-222222222222',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const update = progressItem()
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const progressedTask: Task = {
      ...inProgressTask,
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const createProgressUpdate = vi
      .fn<TaskContextValue['createProgressUpdate']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'network_unavailable', message: '网络暂时不可用。' },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'permission_denied', message: '权限已变化。' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { task: progressedTask, update, was_existing: false },
      })
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: inProgressTask })
        .mockResolvedValueOnce({ ok: true, data: progressedTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValue({ ok: true, data: [historyItem(startTransition)] }),
      listUpdates: vi
        .fn<TaskContextValue['listUpdates']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [update] }),
      createProgressUpdate,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.type(await screen.findByLabelText(/今日完成内容/), 'Retry work')
    const progressInput = screen.getByLabelText(/当前完成比例/)
    await user.clear(progressInput)
    await user.type(progressInput, '40')
    const submit = screen.getByRole('button', { name: '提交进展' })
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络暂时不可用。',
    )
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('权限已变化。')
    await user.click(submit)
    await screen.findByRole('progressbar', { name: '当前任务进度 40%' })

    expect(createProgressUpdate).toHaveBeenCalledTimes(3)
    expect(createProgressUpdate.mock.calls[0][0].idempotencyKey).toBe(
      createProgressUpdate.mock.calls[1][0].idempotencyKey,
    )
    expect(createProgressUpdate.mock.calls[2][0].idempotencyKey).not.toBe(
      createProgressUpdate.mock.calls[1][0].idempotencyKey,
    )
  })

  it('非 assignee 只读时间线，不显示进展写入口', async () => {
    const startTransition = {
      transition_id: 'acacacac-3333-4333-8333-333333333333',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const update = progressItem({
      created_by: MEMBER_ID,
      created_by_display_name: '虚构成员',
    })
    const readerTask: Task = {
      ...task,
      assignee_id: MEMBER_ID,
      assignee_display_name: '虚构成员',
      status: 'in_progress',
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
    }
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: readerTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: [historyItem(startTransition)],
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    expect(
      await screen.findByText('Fictional completed work'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('今日完成内容')).not.toBeInTheDocument()
    expect(
      screen.getByText('只有当前任务负责人可以新增进展。'),
    ).toBeInTheDocument()
  })

  it('进展内标记阻塞必须经过确认并刷新 Task 3.3 block 关联', async () => {
    const user = userEvent.setup()
    const startTransition = {
      transition_id: 'acacacac-4444-4444-8444-444444444444',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const blockTransition = {
      transition_id: 'acacacac-5555-4555-8555-555555555555',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-10T02:00:00+00:00',
    }
    const update = progressItem({
      progress: 50,
      is_blocked: true,
      block_transition_id: blockTransition.transition_id,
    })
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const blockedTask: Task = {
      ...inProgressTask,
      status: 'blocked',
      progress: 50,
      blocker_reason: 'Fictional blocker',
      blocked_at: blockTransition.created_at,
      blocked_by: FICTIONAL_APP_USER_ID,
      blocked_by_display_name: '虚构负责人',
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: inProgressTask })
        .mockResolvedValueOnce({ ok: true, data: blockedTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition)],
        })
        .mockResolvedValueOnce({
          ok: true,
          data: [
            historyItem(startTransition),
            historyItem(blockTransition, 'Fictional blocker'),
          ],
        }),
      listUpdates: vi
        .fn<TaskContextValue['listUpdates']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [update] }),
      createProgressUpdate: vi.fn(async () => ({
        ok: true as const,
        data: { task: blockedTask, update, was_existing: false },
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.type(await screen.findByLabelText(/今日完成内容/), 'Block work')
    const progressInput = screen.getByLabelText(/当前完成比例/)
    await user.clear(progressInput)
    await user.type(progressInput, '50')
    await user.click(screen.getByLabelText('提交进展时同时将任务标记为阻塞'))
    const progressForm = screen
      .getByRole('heading', { name: '更新进展' })
      .closest('form')
    expect(progressForm).not.toBeNull()
    await user.type(
      within(progressForm as HTMLFormElement).getByLabelText(/阻塞原因/),
      'Fictional blocker',
    )
    await user.click(screen.getByRole('button', { name: '提交进展' }))
    expect(
      screen.getByRole('heading', { name: '确认同时标记阻塞？' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认提交并标记阻塞' }))

    expect(tasks.createProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        markBlocked: true,
        blockerReason: 'Fictional blocker',
      }),
    )
    expect(await screen.findByText('当前状态：已阻塞')).toBeInTheDocument()
    expect(screen.getByText('当时处于阻塞')).toBeInTheDocument()
    expect(screen.getByText('虚构负责人 · 标记阻塞')).toBeInTheDocument()
  })

  it('blocked assignee 可继续提交进展，但不会重复 block 或隐式 resume', async () => {
    const user = userEvent.setup()
    const blockTransition = {
      transition_id: 'acacacac-6666-4666-8666-666666666666',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const blockedTask: Task = {
      ...task,
      status: 'blocked',
      blocker_reason: 'Fictional existing blocker',
      blocked_at: blockTransition.created_at,
      blocked_by: FICTIONAL_APP_USER_ID,
      blocked_by_display_name: '虚构负责人',
    }
    const update = progressItem({
      progress: 60,
      is_blocked: true,
      block_transition_id: null,
    })
    const progressedBlockedTask: Task = {
      ...blockedTask,
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const blockedHistory = [
      historyItem(blockTransition, 'Fictional existing blocker'),
    ]
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: blockedTask })
        .mockResolvedValueOnce({ ok: true, data: progressedBlockedTask }),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: blockedHistory,
      })),
      listUpdates: vi
        .fn<TaskContextValue['listUpdates']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [update] }),
      createProgressUpdate: vi.fn(async () => ({
        ok: true as const,
        data: { task: progressedBlockedTask, update, was_existing: false },
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.type(
      await screen.findByLabelText(/今日完成内容/),
      'Blocked work',
    )
    const progressInput = screen.getByLabelText(/当前完成比例/)
    await user.clear(progressInput)
    await user.type(progressInput, '60')
    expect(
      screen.queryByLabelText('提交进展时同时将任务标记为阻塞'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '提交进展' }))

    expect(tasks.createProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ markBlocked: false, blockerReason: '' }),
    )
    expect(await screen.findByText('当前状态：已阻塞')).toBeInTheDocument()
    expect(screen.getByText('Fictional existing blocker')).toBeInTheDocument()
    expect(screen.getByText('当时处于阻塞')).toBeInTheDocument()
    expect(screen.getAllByText('虚构负责人 · 标记阻塞')).toHaveLength(1)
  })

  it('独立标记阻塞后归一化隐藏字段并保留普通进展草稿', async () => {
    const user = userEvent.setup()
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const startTransition = {
      transition_id: 'acacacac-7777-4777-8777-777777777777',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const blockTransition = {
      transition_id: 'acacacac-8888-4888-8888-888888888888',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-10T02:00:00+00:00',
    }
    const blockedTask: Task = {
      ...inProgressTask,
      status: 'blocked',
      blocker_reason: 'Fictional independent blocker',
      blocked_at: blockTransition.created_at,
      blocked_by: FICTIONAL_APP_USER_ID,
      blocked_by_display_name: '虚构负责人',
      updated_at: blockTransition.created_at,
    }
    const update = progressItem({
      record_date: '2026-08-09',
      completed_content: 'Fictional preserved draft',
      progress: 67,
      issues: 'Fictional preserved issue',
      next_steps: 'Fictional preserved next step',
      needs_assistance: true,
      is_blocked: true,
      block_transition_id: null,
      created_at: '2026-08-10T03:00:00+00:00',
    })
    const progressedBlockedTask: Task = {
      ...blockedTask,
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const initialHistory = [historyItem(startTransition)]
    const blockedHistory = [
      historyItem(startTransition),
      historyItem(blockTransition, 'Fictional independent blocker'),
    ]
    const createProgressUpdate = vi.fn(async () => ({
      ok: true as const,
      data: { task: progressedBlockedTask, update, was_existing: false },
    }))
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: inProgressTask })
        .mockResolvedValueOnce({ ok: true, data: blockedTask })
        .mockResolvedValueOnce({ ok: true, data: progressedBlockedTask }),
      block: vi.fn(async () => ({
        ok: true as const,
        data: transitionResult(blockedTask, blockTransition),
      })),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({ ok: true, data: initialHistory })
        .mockResolvedValueOnce({ ok: true, data: blockedHistory })
        .mockResolvedValueOnce({ ok: true, data: blockedHistory }),
      listUpdates: vi
        .fn<TaskContextValue['listUpdates']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [update] }),
      createProgressUpdate,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    const recordDate = await screen.findByLabelText(/进展日期/)
    fireEvent.change(recordDate, { target: { value: '2026-08-09' } })
    fireEvent.change(screen.getByLabelText(/今日完成内容/), {
      target: { value: 'Fictional preserved draft' },
    })
    const progressInput = screen.getByLabelText(/当前完成比例/)
    fireEvent.change(progressInput, { target: { value: '67' } })
    fireEvent.change(screen.getByLabelText('遇到的问题'), {
      target: { value: 'Fictional preserved issue' },
    })
    fireEvent.change(screen.getByLabelText('下一步计划'), {
      target: { value: 'Fictional preserved next step' },
    })
    await user.click(screen.getByLabelText('需要协助'))
    await user.click(screen.getByLabelText('提交进展时同时将任务标记为阻塞'))
    const progressForm = screen
      .getByRole('heading', { name: '更新进展' })
      .closest('form')
    expect(progressForm).not.toBeNull()
    fireEvent.change(
      within(progressForm as HTMLFormElement).getByLabelText(/阻塞原因/),
      { target: { value: 'Fictional stale progress blocker' } },
    )

    await user.click(screen.getByRole('button', { name: '标记阻塞' }))
    const statusDialog = screen.getByRole('dialog')
    fireEvent.change(within(statusDialog).getByLabelText(/阻塞原因/), {
      target: { value: 'Fictional independent blocker' },
    })
    await user.click(
      within(statusDialog).getByRole('button', { name: '确认标记阻塞' }),
    )

    expect(await screen.findByText('当前状态：已阻塞')).toBeInTheDocument()
    expect(screen.getByLabelText(/进展日期/)).toHaveValue('2026-08-09')
    expect(screen.getByLabelText(/今日完成内容/)).toHaveValue(
      'Fictional preserved draft',
    )
    expect(screen.getByLabelText(/当前完成比例/)).toHaveValue(67)
    expect(screen.getByLabelText('遇到的问题')).toHaveValue(
      'Fictional preserved issue',
    )
    expect(screen.getByLabelText('下一步计划')).toHaveValue(
      'Fictional preserved next step',
    )
    expect(screen.getByLabelText('需要协助')).toBeChecked()
    expect(
      screen.queryByLabelText('提交进展时同时将任务标记为阻塞'),
    ).not.toBeInTheDocument()
    const blockedProgressForm = screen
      .getByRole('heading', { name: '更新进展' })
      .closest('form')
    expect(blockedProgressForm).not.toBeNull()
    expect(
      within(blockedProgressForm as HTMLFormElement).queryByLabelText(
        /阻塞原因/,
      ),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '提交进展' }))

    expect(createProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        recordDate: '2026-08-09',
        completedContent: 'Fictional preserved draft',
        progress: 67,
        issues: 'Fictional preserved issue',
        nextSteps: 'Fictional preserved next step',
        needsAssistance: true,
        markBlocked: false,
        blockerReason: '',
      }),
    )
    expect(
      screen.queryByText('已阻塞任务不能重复标记阻塞。'),
    ).not.toBeInTheDocument()
  })

  it('阻塞 Dialog 拒绝空白原因，成功后同步 current blocker 与历史', async () => {
    const user = userEvent.setup()
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const blockedTask: Task = {
      ...inProgressTask,
      status: 'blocked',
      blocker_reason: 'Fictional dependency',
      blocked_at: '2026-08-09T02:00:00+00:00',
      blocked_by: FICTIONAL_APP_USER_ID,
      blocked_by_display_name: '虚构负责人',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const startTransition = {
      transition_id: 'dddddddd-1111-4111-8111-111111111110',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T01:30:00+00:00',
    }
    const blockTransition = {
      transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const listStatusHistory = vi
      .fn<TaskContextValue['listStatusHistory']>()
      .mockResolvedValueOnce({ ok: true, data: [historyItem(startTransition)] })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          historyItem(startTransition),
          historyItem(blockTransition, 'Fictional dependency'),
        ],
      })
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true as const, data: inProgressTask })
        .mockResolvedValueOnce({ ok: true as const, data: blockedTask }),
      block: vi.fn(async () => ({
        ok: true as const,
        data: transitionResult(blockedTask, blockTransition),
      })),
      listStatusHistory,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '标记阻塞' }))
    const reason = screen.getByLabelText(/阻塞原因/u)
    fireEvent.change(reason, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '确认标记阻塞' })).toBeDisabled()
    await user.clear(reason)
    await user.type(reason, 'Fictional dependency')
    await user.click(screen.getByRole('button', { name: '确认标记阻塞' }))

    expect(tasks.block).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        blockerReason: 'Fictional dependency',
        idempotencyKey: expect.any(String),
      }),
    )
    expect(
      await screen.findByRole('heading', { name: '当前阻塞' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fictional dependency')).toBeInTheDocument()
    expect(
      screen.getByText('阻塞原因：Fictional dependency'),
    ).toBeInTheDocument()
    expect(screen.getByText('虚构负责人 · 标记阻塞')).toBeInTheDocument()
  })

  it('取消必须确认，成功后 terminal 状态不再显示 Task 3.3 action', async () => {
    const user = userEvent.setup()
    const cancelledTask: Task = {
      ...task,
      status: 'cancelled',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const transition = {
      transition_id: 'eeeeeeee-2222-4222-8222-222222222222',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'cancelled' as const,
      action: 'cancel' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true as const, data: task })
        .mockResolvedValueOnce({ ok: true as const, data: cancelledTask }),
      cancel: vi.fn(async () => ({
        ok: true as const,
        data: transitionResult(cancelledTask, transition),
      })),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(transition)],
        }),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '取消任务' }))
    expect(
      screen.getByRole('heading', { name: '确认取消任务？' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认取消任务' }))
    expect(await screen.findByText('当前状态：已取消')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: task.title }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '取消任务' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/今日完成内容/)).not.toBeInTheDocument()
    expect(
      screen.getByText('当前任务状态不允许新增执行进展。'),
    ).toBeInTheDocument()
  })

  it('网络失败重试复用同一状态 intent key', async () => {
    const user = userEvent.setup()
    const startedTask: Task = {
      ...task,
      status: 'in_progress',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const transition = {
      transition_id: 'eeeeeeee-3333-4333-8333-333333333333',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const start = vi
      .fn<TaskContextValue['start']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'network_unavailable', message: '网络暂时不可用。' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: transitionResult(startedTask, transition),
      })
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true as const, data: task })
        .mockResolvedValueOnce({ ok: true as const, data: startedTask }),
      start,
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(transition)],
        }),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '开始任务' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络暂时不可用。',
    )
    await user.click(screen.getByRole('button', { name: '开始任务' }))
    await screen.findByText('当前状态：进行中')

    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[0][0].idempotencyKey).toBe(
      start.mock.calls[1][0].idempotencyKey,
    )
  })

  it('任务 A 的迟到 success 不会覆盖已切换到的任务 B', async () => {
    const first = createDeferred<{ ok: true; data: Task }>()
    const secondTask = {
      ...task,
      task_id: SECOND_TASK_ID,
      title: '虚构深链任务乙',
    }
    const tasks = taskValue({
      get: vi.fn((taskId: string) =>
        taskId === TASK_ID
          ? first.promise
          : Promise.resolve({ ok: true as const, data: secondTask }),
      ),
    })
    const user = userEvent.setup()
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={
          <>
            <Link to={`/projects/${PROJECT_ID}/tasks/${SECOND_TASK_ID}`}>
              切换任务
            </Link>
            <TaskDetailPage />
          </>
        }
      />,
      projectValue(),
      tasks,
    )

    await waitFor(() => expect(tasks.get).toHaveBeenCalledWith(TASK_ID))
    await user.click(screen.getByRole('link', { name: '切换任务' }))
    expect(
      await screen.findByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()
    await act(async () => first.resolve({ ok: true, data: task }))
    expect(
      screen.getByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: task.title }),
    ).not.toBeInTheDocument()
  })

  it('任务 A 的 start 迟到不会污染已切换到的任务 B', async () => {
    const action = createDeferred<{ ok: true; data: TaskTransitionResult }>()
    const secondTask: Task = {
      ...task,
      task_id: SECOND_TASK_ID,
      title: '虚构状态任务乙',
    }
    const startedTask: Task = { ...task, status: 'in_progress' }
    const transition = {
      transition_id: 'eeeeeeee-4444-4444-8444-444444444444',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const tasks = taskValue({
      get: vi.fn((requestedTaskId: string) =>
        Promise.resolve({
          ok: true as const,
          data: requestedTaskId === TASK_ID ? task : secondTask,
        }),
      ),
      start: vi.fn(() => action.promise),
    })
    const user = userEvent.setup()
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={
          <>
            <Link to={`/projects/${PROJECT_ID}/tasks/${SECOND_TASK_ID}`}>
              切换状态任务
            </Link>
            <TaskDetailPage />
          </>
        }
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '开始任务' }))
    await user.click(screen.getByRole('link', { name: '切换状态任务' }))
    expect(
      await screen.findByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()

    await act(async () =>
      action.resolve({
        ok: true,
        data: transitionResult(startedTask, transition),
      }),
    )
    expect(
      screen.getByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()
    expect(screen.getByText('当前状态：待开始')).toBeInTheDocument()
  })

  it('任务 A 的进展迟到 success 不会覆盖任务 B 的进度和时间线', async () => {
    const progressAction = createDeferred<{
      ok: true
      data: {
        task: Task
        update: TaskProgressUpdate
        was_existing: boolean
      }
    }>()
    const firstTask: Task = { ...task, status: 'in_progress' }
    const secondTask: Task = {
      ...firstTask,
      task_id: SECOND_TASK_ID,
      title: '虚构进展任务乙',
    }
    const firstStart = {
      transition_id: 'eeeeeeee-5555-4555-8555-555555555555',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const secondStart = {
      ...firstStart,
      transition_id: 'eeeeeeee-6666-4666-8666-666666666666',
      task_id: SECOND_TASK_ID,
    }
    const firstUpdate = progressItem()
    const progressedFirstTask: Task = {
      ...firstTask,
      progress: firstUpdate.progress,
      last_progress_at: firstUpdate.created_at,
      last_progress_by: firstUpdate.created_by,
      last_progress_by_display_name: firstUpdate.created_by_display_name,
      updated_at: firstUpdate.created_at,
    }
    const tasks = taskValue({
      get: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data: requestedTaskId === TASK_ID ? firstTask : secondTask,
      })),
      listStatusHistory: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data: [
          historyItem(requestedTaskId === TASK_ID ? firstStart : secondStart),
        ],
      })),
      createProgressUpdate: vi.fn(() => progressAction.promise),
    })
    const user = userEvent.setup()
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={
          <>
            <Link to={`/projects/${PROJECT_ID}/tasks/${SECOND_TASK_ID}`}>
              切换进展任务
            </Link>
            <TaskDetailPage />
          </>
        }
      />,
      projectValue(),
      tasks,
    )

    await user.type(await screen.findByLabelText(/今日完成内容/), 'Late work')
    await user.click(screen.getByRole('button', { name: '提交进展' }))
    await user.click(screen.getByRole('link', { name: '切换进展任务' }))
    expect(
      await screen.findByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()

    await act(async () =>
      progressAction.resolve({
        ok: true,
        data: {
          task: progressedFirstTask,
          update: firstUpdate,
          was_existing: false,
        },
      }),
    )
    expect(
      screen.getByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: '当前任务进度 0%' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Fictional completed work'),
    ).not.toBeInTheDocument()
  })

  it('进展 mutation 在组件卸载后返回时不再刷新或提交状态', async () => {
    const progressAction = createDeferred<{
      ok: true
      data: {
        task: Task
        update: TaskProgressUpdate
        was_existing: boolean
      }
    }>()
    const inProgressTask: Task = { ...task, status: 'in_progress' }
    const startTransition = {
      transition_id: 'eeeeeeee-7777-4777-8777-777777777777',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const update = progressItem()
    const progressedTask: Task = {
      ...inProgressTask,
      progress: update.progress,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
    }
    const listUpdates = vi.fn(async () => ({ ok: true as const, data: [] }))
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: inProgressTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: [historyItem(startTransition)],
      })),
      listUpdates,
      createProgressUpdate: vi.fn(() => progressAction.promise),
    })
    const user = userEvent.setup()
    const view = renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.type(
      await screen.findByLabelText(/今日完成内容/),
      'Unmount work',
    )
    await user.click(screen.getByRole('button', { name: '提交进展' }))
    view.unmount()
    await act(async () =>
      progressAction.resolve({
        ok: true,
        data: { task: progressedTask, update, was_existing: false },
      }),
    )

    expect(listUpdates).toHaveBeenCalledTimes(1)
  })

  it('Major：start 成功后另一 actor 推进到 cancelled，页面显示最新一致状态', async () => {
    const user = userEvent.setup()
    const startedTask: Task = {
      ...task,
      status: 'in_progress',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const cancelledTask: Task = {
      ...task,
      status: 'cancelled',
      updated_at: '2026-08-09T03:00:00+00:00',
    }
    const startTransition = {
      transition_id: 'ffffffff-1111-4111-8111-111111111101',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const cancelTransition = {
      transition_id: 'ffffffff-2222-4222-8222-222222222202',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'cancelled' as const,
      action: 'cancel' as const,
      created_at: '2026-08-09T03:00:00+00:00',
    }
    const tasks = taskValue({
      start: vi.fn(async () => ({
        ok: true as const,
        data: transitionResult(startedTask, startTransition),
      })),
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true as const, data: task })
        .mockResolvedValueOnce({ ok: true as const, data: cancelledTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition), historyItem(cancelTransition)],
        }),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '开始任务' }))

    expect(await screen.findByText('当前状态：已取消')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '标记阻塞' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '恢复进行中' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '取消任务' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.queryByText('当前状态：进行中')).not.toBeInTheDocument()
  })

  it('Major：初始加载 task/history 不一致时重试并最终进入 ready', async () => {
    const inProgressTask: Task = {
      ...task,
      status: 'in_progress',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const startTransition = {
      transition_id: 'ffffffff-3333-4333-8333-333333333303',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const listStatusHistory = vi
      .fn<TaskContextValue['listStatusHistory']>()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [historyItem(startTransition)] })
    const get = vi
      .fn<TaskContextValue['get']>()
      .mockResolvedValueOnce({ ok: true as const, data: inProgressTask })
      .mockResolvedValueOnce({ ok: true as const, data: inProgressTask })
    const tasks = taskValue({ get, listStatusHistory })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    expect(await screen.findByText('当前状态：进行中')).toBeInTheDocument()
    expect(listStatusHistory).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByRole('heading', { name: '无法打开任务' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('当前状态：待开始')).not.toBeInTheDocument()
  })

  it('Major：task/history 持续不一致时 fail closed，不提交不一致数据到 UI', async () => {
    const inProgressTask: Task = {
      ...task,
      status: 'in_progress',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const listStatusHistory = vi
      .fn<TaskContextValue['listStatusHistory']>()
      .mockResolvedValue({ ok: true, data: [] })
    const get = vi
      .fn<TaskContextValue['get']>()
      .mockResolvedValue({ ok: true, data: inProgressTask })
    const tasks = taskValue({ get, listStatusHistory })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    expect(
      await screen.findByRole('heading', { name: '无法打开任务' }),
    ).toBeInTheDocument()
    expect(listStatusHistory).toHaveBeenCalledTimes(
      TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
    )
    expect(screen.queryByText('当前状态')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '开始任务' }),
    ).not.toBeInTheDocument()
  })

  it('P2：开始任务 in-flight 时其它状态操作入口 disabled 且不触发', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<{ ok: true; data: TaskTransitionResult }>()
    const startedTask: Task = {
      ...task,
      status: 'in_progress',
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    const startTransition = {
      transition_id: 'ffffffff-4444-4444-8444-444444444404',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const tasks = taskValue({
      start: vi.fn(() => deferred.promise),
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true as const, data: task })
        .mockResolvedValueOnce({ ok: true as const, data: startedTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition)],
        }),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '开始任务' }))

    const cancelButton = screen.getByRole('button', { name: '取消任务' })
    expect(cancelButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /开始任务/ })).toBeDisabled()
    fireEvent.click(cancelButton)
    expect(tasks.cancel).not.toHaveBeenCalled()

    await act(async () => {
      deferred.resolve({
        ok: true,
        data: transitionResult(startedTask, startTransition),
      })
    })
    expect(await screen.findByText('当前状态：进行中')).toBeInTheDocument()
  })
  it('blocks a direct edit deep link for pending-review tasks', async () => {
    const pendingTask: Task = {
      ...task,
      status: 'pending_review',
      progress: 100,
    }
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}/edit`,
      <Route
        path="/projects/:projectId/tasks/:taskId/edit"
        element={<EditTaskPage />}
      />,
      projectValue(),
      taskValue({
        get: vi.fn(async () => ({ ok: true as const, data: pendingTask })),
      }),
    )

    expect(
      await screen.findByRole('heading', { name: '任务当前不可编辑' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/任务标题/)).not.toBeInTheDocument()
  })

  it('submits a 100% in-progress task and refreshes to the linked pending-review ledger', async () => {
    const user = userEvent.setup()
    const startTransition = {
      transition_id: 'abababab-5555-4555-8555-555555555555',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const update = progressItem({ progress: 100 })
    const readyTask: Task = {
      ...task,
      status: 'in_progress',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: update.created_at,
    }
    const submitTransition = {
      transition_id: 'abababab-4444-4444-8444-444444444444',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const review = reviewItem()
    const pendingTask: Task = {
      ...readyTask,
      status: 'pending_review',
      updated_at: submitTransition.created_at,
    }
    const submitReview = vi.fn<TaskContextValue['submitReview']>(async () => ({
      ok: true as const,
      data: {
        review,
        transition: submitTransition,
        was_existing: false,
      },
    }))
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: readyTask })
        .mockResolvedValueOnce({ ok: true, data: pendingTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition)],
        })
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition), historyItem(submitTransition)],
        }),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi
        .fn<TaskContextValue['listReviews']>()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [review] }),
      submitReview,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '提交验收' }))
    expect(
      screen.getByRole('heading', { name: '确认提交验收？' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认提交验收' }))

    expect(await screen.findByText('当前状态：待验收')).toBeInTheDocument()
    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        workspaceId: FICTIONAL_WORKSPACE_ID,
        idempotencyKey: expect.any(String),
      }),
    )
    expect(
      screen.getByText('Fictional assignee · 提交验收'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '编辑任务' }),
    ).not.toBeInTheDocument()
  })

  it('shows the 100% requirement and gives an ordinary pending-review reader no mutation controls', async () => {
    const update = progressItem({ progress: 40 })
    const inProgressTask: Task = {
      ...task,
      status: 'in_progress',
      progress: 40,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
    }
    const startTransition = {
      transition_id: 'abababab-6666-4666-8666-666666666666',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: inProgressTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: [historyItem(startTransition)],
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    expect(
      await screen.findByText('当前进度为 40%，达到 100% 后才能提交验收。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '提交验收' }),
    ).not.toBeInTheDocument()
  })

  it('shows an ordinary pending-review reader a waiting state without mutation or edit controls', async () => {
    const update = progressItem({
      progress: 100,
      created_by: MEMBER_ID,
      created_by_display_name: 'Fictional assignee',
    })
    const startTransition = {
      transition_id: 'acacacac-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'acacacac-2222-4222-8222-222222222222',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const review = reviewItem({
      actor_id: MEMBER_ID,
      status_transition_id: submitTransition.transition_id,
    })
    const pendingTask: Task = {
      ...task,
      assignee_id: MEMBER_ID,
      reviewer_id: OTHER_REVIEWER_ID,
      status: 'pending_review',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: submitTransition.created_at,
    }
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: pendingTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: [
          { ...historyItem(startTransition), actor_id: MEMBER_ID },
          { ...historyItem(submitTransition), actor_id: MEMBER_ID },
        ],
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi.fn(async () => ({ ok: true as const, data: [review] })),
    })
    const customProject = { ...project, owner_id: MEMBER_ID }
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: customProject })),
      }),
      tasks,
      workspaceValue('member'),
    )

    expect(await screen.findByText('等待验收。')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '通过验收' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '退回修改' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '编辑任务' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the return dialog open with a required reason and a safe backend error', async () => {
    const user = userEvent.setup()
    const update = progressItem({
      progress: 100,
      created_by: MEMBER_ID,
      created_by_display_name: 'Fictional assignee',
    })
    const startTransition = {
      transition_id: 'abababab-7777-4777-8777-777777777777',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'abababab-8888-4888-8888-888888888888',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const review = reviewItem({
      actor_id: MEMBER_ID,
      status_transition_id: submitTransition.transition_id,
    })
    const pendingTask: Task = {
      ...task,
      assignee_id: MEMBER_ID,
      reviewer_id: FICTIONAL_APP_USER_ID,
      status: 'pending_review',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: submitTransition.created_at,
    }
    const returnReview = vi.fn<TaskContextValue['returnReview']>(async () => ({
      ok: false as const,
      error: {
        code: 'review_concurrent_state_changed',
        message: '验收状态正在变化，请刷新后重试。',
      },
    }))
    const taskHistory: TaskStatusHistoryItem[] = [
      { ...historyItem(startTransition), actor_id: MEMBER_ID },
      { ...historyItem(submitTransition), actor_id: MEMBER_ID },
    ]
    const customProject = { ...project, owner_id: MEMBER_ID }
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: pendingTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: taskHistory,
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi.fn(async () => ({ ok: true as const, data: [review] })),
      returnReview,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: customProject })),
      }),
      tasks,
      workspaceValue('member'),
    )

    await user.click(await screen.findByRole('button', { name: '退回修改' }))
    const dialog = screen.getByRole('dialog')
    const reason = within(dialog).getByLabelText(/退回原因/)
    await user.type(reason, '   ')
    expect(
      within(dialog).getByRole('button', { name: '确认退回修改' }),
    ).toBeDisabled()
    await user.clear(reason)
    await user.type(reason, 'Please add evidence.')
    await user.click(
      within(dialog).getByRole('button', { name: '确认退回修改' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '验收状态正在变化，请刷新后重试。',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(returnReview).toHaveBeenCalledWith(
      expect.objectContaining({ returnReason: 'Please add evidence.' }),
    )
  })

  it('approves a pending review and refreshes the authoritative completion snapshot', async () => {
    const user = userEvent.setup()
    const update = progressItem({ progress: 100 })
    const startTransition = {
      transition_id: 'adadadad-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'adadadad-2222-4222-8222-222222222222',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const approveTransition = {
      transition_id: 'adadadad-3333-4333-8333-333333333333',
      task_id: TASK_ID,
      sequence: 3,
      from_status: 'pending_review' as const,
      to_status: 'completed' as const,
      action: 'approve_review' as const,
      created_at: '2026-08-10T04:00:00+00:00',
    }
    const submitReview = reviewItem({
      status_transition_id: submitTransition.transition_id,
    })
    const approveReview = reviewItem({
      review_id: APPROVE_REVIEW_ID,
      sequence: 2,
      action: 'approve',
      actor_display_name: 'Fictional manager',
      from_status: 'pending_review',
      to_status: 'completed',
      status_transition_id: approveTransition.transition_id,
      created_at: approveTransition.created_at,
    })
    const pendingTask: Task = {
      ...task,
      status: 'pending_review',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: submitTransition.created_at,
    }
    const completedTask: Task = {
      ...pendingTask,
      status: 'completed',
      completed_at: approveReview.created_at,
      completed_by: approveReview.actor_id,
      completed_by_display_name: approveReview.actor_display_name,
      updated_at: approveReview.created_at,
    }
    const approveReviewMutation = vi.fn<TaskContextValue['approveReview']>(
      async () => ({
        ok: true as const,
        data: {
          review: approveReview,
          transition: approveTransition,
          was_existing: false,
        },
      }),
    )
    const tasks = taskValue({
      get: vi
        .fn<TaskContextValue['get']>()
        .mockResolvedValueOnce({ ok: true, data: pendingTask })
        .mockResolvedValueOnce({ ok: true, data: completedTask }),
      listStatusHistory: vi
        .fn<TaskContextValue['listStatusHistory']>()
        .mockResolvedValueOnce({
          ok: true,
          data: [historyItem(startTransition), historyItem(submitTransition)],
        })
        .mockResolvedValueOnce({
          ok: true,
          data: [
            historyItem(startTransition),
            historyItem(submitTransition),
            {
              ...historyItem(approveTransition),
              actor_display_name: 'Fictional manager',
            },
          ],
        }),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi
        .fn<TaskContextValue['listReviews']>()
        .mockResolvedValueOnce({ ok: true, data: [submitReview] })
        .mockResolvedValueOnce({
          ok: true,
          data: [submitReview, approveReview],
        }),
      approveReview: approveReviewMutation,
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '通过验收' }))
    await user.click(screen.getByRole('button', { name: '确认通过验收' }))

    expect(await screen.findByText('当前状态：已完成')).toBeInTheDocument()
    expect(screen.getByText('Fictional manager')).toBeInTheDocument()
    expect(approveReviewMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        idempotencyKey: expect.any(String),
      }),
    )
  })

  it('renders completion metadata and the append-only review timeline without edit or execution actions', async () => {
    const update = progressItem({ progress: 100 })
    const startTransition = {
      transition_id: 'abababab-9999-4999-8999-999999999999',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'bcbcbcbc-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const approveTransition = {
      transition_id: 'bcbcbcbc-2222-4222-8222-222222222222',
      task_id: TASK_ID,
      sequence: 3,
      from_status: 'pending_review' as const,
      to_status: 'completed' as const,
      action: 'approve_review' as const,
      created_at: '2026-08-10T04:00:00+00:00',
    }
    const submitReview = reviewItem({
      status_transition_id: submitTransition.transition_id,
    })
    const approveReview = reviewItem({
      review_id: APPROVE_REVIEW_ID,
      sequence: 2,
      action: 'approve',
      actor_id: MEMBER_ID,
      actor_display_name: 'Fictional reviewer',
      from_status: 'pending_review',
      to_status: 'completed',
      status_transition_id: approveTransition.transition_id,
      created_at: approveTransition.created_at,
    })
    const completedTask: Task = {
      ...task,
      status: 'completed',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      completed_at: approveReview.created_at,
      completed_by: approveReview.actor_id,
      completed_by_display_name: approveReview.actor_display_name,
      updated_at: approveReview.created_at,
    }
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: completedTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: [
          historyItem(startTransition),
          historyItem(submitTransition),
          {
            ...historyItem(approveTransition),
            actor_id: MEMBER_ID,
            actor_display_name: 'Fictional reviewer',
          },
        ],
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi.fn(async () => ({
        ok: true as const,
        data: [submitReview, approveReview],
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    expect(await screen.findByText('Fictional reviewer')).toBeInTheDocument()
    expect(
      screen.getAllByText('Fictional reviewer · 通过验收').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('#2').length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('link', { name: '编辑任务' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '通过验收' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '提交进展' }),
    ).not.toBeInTheDocument()
  })

  it('ignores a late review success after navigating from task A to task B', async () => {
    const user = userEvent.setup()
    const action = createDeferred<{ ok: true; data: TaskReviewResult }>()
    const update = progressItem({ progress: 100 })
    const firstStart = {
      transition_id: 'bcbcbcbc-3333-4333-8333-333333333333',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'bcbcbcbc-4444-4444-8444-444444444444',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const submitReview = reviewItem({
      status_transition_id: submitTransition.transition_id,
    })
    const firstTask: Task = {
      ...task,
      status: 'pending_review',
      progress: 100,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
    }
    const secondTask: Task = {
      ...task,
      task_id: SECOND_TASK_ID,
      title: 'Fictional review task B',
    }
    const approveTransition = {
      transition_id: 'bcbcbcbc-5555-4555-8555-555555555555',
      task_id: TASK_ID,
      sequence: 3,
      from_status: 'pending_review' as const,
      to_status: 'completed' as const,
      action: 'approve_review' as const,
      created_at: '2026-08-10T04:00:00+00:00',
    }
    const approveReview = reviewItem({
      review_id: APPROVE_REVIEW_ID,
      sequence: 2,
      action: 'approve',
      from_status: 'pending_review',
      to_status: 'completed',
      status_transition_id: approveTransition.transition_id,
      created_at: approveTransition.created_at,
    })
    const tasks = taskValue({
      get: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data: requestedTaskId === TASK_ID ? firstTask : secondTask,
      })),
      listStatusHistory: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data:
          requestedTaskId === TASK_ID
            ? [historyItem(firstStart), historyItem(submitTransition)]
            : [],
      })),
      listUpdates: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data: requestedTaskId === TASK_ID ? [update] : [],
      })),
      listReviews: vi.fn(async (requestedTaskId: string) => ({
        ok: true as const,
        data: requestedTaskId === TASK_ID ? [submitReview] : [],
      })),
      approveReview: vi.fn(() => action.promise),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={
          <>
            <Link to={`/projects/${PROJECT_ID}/tasks/${SECOND_TASK_ID}`}>
              Switch review task
            </Link>
            <TaskDetailPage />
          </>
        }
      />,
      projectValue(),
      tasks,
    )

    await user.click(await screen.findByRole('button', { name: '通过验收' }))
    await user.click(screen.getByRole('button', { name: '确认通过验收' }))
    await user.click(screen.getByRole('link', { name: 'Switch review task' }))
    expect(
      await screen.findByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()

    await act(async () => {
      action.resolve({
        ok: true,
        data: {
          review: approveReview,
          transition: approveTransition,
          was_existing: false,
        },
      })
    })
    expect(
      screen.getByRole('heading', { name: secondTask.title }),
    ).toBeInTheDocument()
    expect(screen.getByText('当前状态：待开始')).toBeInTheDocument()
  })

  it('P2：状态历史对 block 与 return_review 的 reason 分别标注阻塞原因与退回原因', async () => {
    const startTransition = {
      transition_id: 'abababab-aaaa-4111-8111-1111111111a1',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'todo' as const,
      to_status: 'in_progress' as const,
      action: 'start' as const,
      created_at: '2026-08-10T01:00:00+00:00',
    }
    const submitTransition = {
      transition_id: 'abababab-aaaa-4222-8222-2222222222a2',
      task_id: TASK_ID,
      sequence: 2,
      from_status: 'in_progress' as const,
      to_status: 'pending_review' as const,
      action: 'submit_review' as const,
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const returnTransition = {
      transition_id: 'abababab-aaaa-4333-8333-3333333333a3',
      task_id: TASK_ID,
      sequence: 3,
      from_status: 'pending_review' as const,
      to_status: 'in_progress' as const,
      action: 'return_review' as const,
      created_at: '2026-08-10T04:00:00+00:00',
    }
    const blockTransition = {
      transition_id: 'abababab-aaaa-4444-8444-4444444444a4',
      task_id: TASK_ID,
      sequence: 4,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-10T05:00:00+00:00',
    }
    const resumeTransition = {
      transition_id: 'abababab-aaaa-4555-8555-5555555555a5',
      task_id: TASK_ID,
      sequence: 5,
      from_status: 'blocked' as const,
      to_status: 'in_progress' as const,
      action: 'resume' as const,
      created_at: '2026-08-10T06:00:00+00:00',
    }
    const update = progressItem({ progress: 40 })
    const inProgressTask: Task = {
      ...task,
      status: 'in_progress',
      progress: 40,
      last_progress_at: update.created_at,
      last_progress_by: update.created_by,
      last_progress_by_display_name: update.created_by_display_name,
      updated_at: resumeTransition.created_at,
    }
    const submitReview = reviewItem({
      review_id: SUBMIT_REVIEW_ID,
      sequence: 1,
      status_transition_id: submitTransition.transition_id,
      from_status: 'in_progress',
      to_status: 'pending_review',
      return_reason: null,
      created_at: submitTransition.created_at,
    })
    const returnReview = reviewItem({
      review_id: APPROVE_REVIEW_ID,
      sequence: 2,
      action: 'return',
      status_transition_id: returnTransition.transition_id,
      from_status: 'pending_review',
      to_status: 'in_progress',
      return_reason: 'Fictional return reason',
      created_at: returnTransition.created_at,
    })
    const taskHistory: TaskStatusHistoryItem[] = [
      historyItem(startTransition),
      historyItem(submitTransition),
      { ...historyItem(returnTransition), reason: 'Fictional return reason' },
      historyItem(blockTransition, 'Fictional blocker'),
      historyItem(resumeTransition),
    ]
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: inProgressTask })),
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: taskHistory,
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [update] })),
      listReviews: vi.fn(async () => ({
        ok: true as const,
        data: [submitReview, returnReview],
      })),
    })
    renderTaskRoutes(
      `/projects/${PROJECT_ID}/tasks/${TASK_ID}`,
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={<TaskDetailPage />}
      />,
      projectValue(),
      tasks,
    )

    const statusSection = (
      await screen.findByRole('heading', { name: '状态历史' })
    ).closest('section')
    expect(statusSection).not.toBeNull()

    expect(
      await within(statusSection as HTMLElement).findByText(
        '阻塞原因：Fictional blocker',
      ),
    ).toBeInTheDocument()
    expect(
      await within(statusSection as HTMLElement).findByText(
        '退回原因：Fictional return reason',
      ),
    ).toBeInTheDocument()
    expect(
      within(statusSection as HTMLElement).queryByText(
        '阻塞原因：Fictional return reason',
      ),
    ).not.toBeInTheDocument()
  })
})

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
