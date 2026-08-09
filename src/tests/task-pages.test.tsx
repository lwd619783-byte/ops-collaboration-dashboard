import { act, render, screen, waitFor } from '@testing-library/react'
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
import type { Task, TaskAssignmentCandidate } from '@/features/tasks'
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
  nextTask: Task,
  transition: TaskTransitionResult['transition'],
): TaskTransitionResult {
  return { task: nextTask, transition, was_existing: false }
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
    const transition = {
      transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
      task_id: TASK_ID,
      sequence: 1,
      from_status: 'in_progress' as const,
      to_status: 'blocked' as const,
      action: 'block' as const,
      created_at: '2026-08-09T02:00:00+00:00',
    }
    const listStatusHistory = vi
      .fn<TaskContextValue['listStatusHistory']>()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        data: [historyItem(transition, 'Fictional dependency')],
      })
    const tasks = taskValue({
      get: vi.fn(async () => ({ ok: true as const, data: inProgressTask })),
      block: vi.fn(async () => ({
        ok: true as const,
        data: transitionResult(blockedTask, transition),
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
    await user.type(reason, '   ')
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
