import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import type { Project, ProjectModule } from '@/features/projects'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { TaskSummary } from '@/features/tasks'
import {
  TaskContext,
  type TaskContextValue,
} from '@/features/tasks/TaskContext'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import { ProjectTasksPage } from '@/pages/ProjectTasksPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import {
  fictionalAppUser,
  fictionalProfile,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const PROJECT_B = 'aaaaaaaa-2222-4222-8222-222222222222'
const MODULE_A = 'bbbbbbbb-1111-4111-8111-111111111111'
const MODULE_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const TASK_A = 'cccccccc-1111-4111-8111-111111111111'
const TASK_B = 'cccccccc-2222-4222-8222-222222222222'
const TASK_C = 'cccccccc-3333-4333-8333-333333333333'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_OWNER_ID = '33333333-3333-4333-8333-333333333333'

function makeProject(projectId: string, name: string): Project {
  return {
    project_id: projectId,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    name,
    description: null,
    project_type: 'operations',
    status: 'active',
    owner_id: PROJECT_OWNER_ID,
    owner_display_name: '虚构项目负责人',
    lead_id: null,
    lead_display_name: null,
    start_date: null,
    due_date: null,
    created_by: PROJECT_OWNER_ID,
    created_at: '2026-08-09T01:00:00+00:00',
    updated_at: '2026-08-09T01:00:00+00:00',
    archived_at: null,
  }
}

const projectA = makeProject(PROJECT_A, '虚构任务中心项目甲')
const projectB = makeProject(PROJECT_B, '虚构任务中心项目乙')

function makeModule(
  projectId: string,
  moduleId: string,
  name: string,
  sortPosition: number,
): ProjectModule {
  return {
    module_id: moduleId,
    project_id: projectId,
    name,
    sort_position: sortPosition,
    created_by: PROJECT_OWNER_ID,
    updated_by: PROJECT_OWNER_ID,
    created_at: '2026-08-09T01:00:00+00:00',
    updated_at: '2026-08-09T01:00:00+00:00',
  }
}

const modulesA = [
  makeModule(PROJECT_A, MODULE_A, '虚构模块甲', 0),
  makeModule(PROJECT_A, MODULE_B, '虚构模块乙', 1),
]

const taskA: TaskSummary = {
  task_id: TASK_A,
  project_id: PROJECT_A,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  module_id: MODULE_A,
  module_name: '虚构模块甲',
  title: '虚构可见任务甲',
  assignee_id: FICTIONAL_APP_USER_ID,
  assignee_display_name: '虚构当前成员',
  collaborators: [{ app_user_id: MEMBER_ID, display_name: '虚构协作成员' }],
  priority: 'high',
  start_date: null,
  due_date: '2000-01-01',
  estimated_hours: null,
  workload_level: 'm',
  visibility: 'restricted',
  status: 'todo',
  progress: 10,
  updated_at: '2026-08-09T03:00:00+00:00',
}

const taskB: TaskSummary = {
  ...taskA,
  task_id: TASK_B,
  module_id: MODULE_B,
  module_name: '虚构模块乙',
  title: '虚构可见任务乙',
  assignee_id: MEMBER_ID,
  assignee_display_name: '虚构协作成员',
  collaborators: [],
  priority: 'low',
  due_date: '2000-01-01',
  visibility: 'project',
  status: 'completed',
  progress: 100,
  updated_at: '2026-08-09T02:00:00+00:00',
}

const taskC: TaskSummary = {
  ...taskA,
  task_id: TASK_C,
  title: '虚构可见任务丙',
  collaborators: [],
  priority: 'urgent',
  due_date: '2999-01-01',
  visibility: 'project',
  status: 'blocked',
  progress: 30,
  updated_at: '2026-08-09T01:00:00+00:00',
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

function workspaceValue(): WorkspaceContextValue {
  return {
    status: 'ready',
    workspaces: [],
    currentWorkspace: {
      workspace_id: FICTIONAL_WORKSPACE_ID,
      workspace_name: '虚构协同空间',
      role: 'member',
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
  const mutation = { ...projectA, changed: true }
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [projectA] })),
    get: vi.fn(async () => ({ ok: true as const, data: projectA })),
    create: vi.fn(async () => ({ ok: true as const, data: projectA })),
    update: vi.fn(async () => ({ ok: true as const, data: projectA })),
    archive: vi.fn(async () => ({ ok: true as const, data: projectA })),
    listMembers: vi.fn(async () => ({ ok: true as const, data: [] })),
    listModules: vi.fn(async () => ({ ok: true as const, data: modulesA })),
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
  rows: TaskSummary[] = [taskA, taskB, taskC],
  overrides: Partial<TaskContextValue> = {},
): TaskContextValue {
  return {
    get: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'not_found_or_forbidden' as const, message: '不可用' },
    })),
    list: vi.fn(async () => ({ ok: true as const, data: rows })),
    listCandidates: vi.fn(async () => ({ ok: true as const, data: [] })),
    create: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
    update: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'permission_denied' as const, message: '不可用' },
    })),
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

function LocationProbe() {
  const location = useLocation()
  return (
    <output aria-label="当前地址">{`${location.pathname}${location.search}`}</output>
  )
}

function renderTaskCenter(
  initialEntry = `/projects/${PROJECT_A}/tasks`,
  projects = projectValue(),
  tasks = taskValue(),
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthContext.Provider value={authValue()}>
        <WorkspaceContext.Provider value={workspaceValue()}>
          <ProjectContext.Provider value={projects}>
            <TaskContext.Provider value={tasks}>
              <LocationProbe />
              <Routes>
                <Route
                  path="/projects/:projectId/tasks"
                  element={
                    <>
                      <Link to={`/projects/${PROJECT_B}/tasks`}>切换项目</Link>
                      <ProjectTasksPage />
                    </>
                  }
                />
                <Route
                  path="/projects/:projectId/tasks/:taskId"
                  element={<p>任务详情占位</p>}
                />
              </Routes>
            </TaskContext.Provider>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('项目任务中心', () => {
  it('项目详情对普通成员提供任务中心入口但不提供创建入口', async () => {
    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_A}`]}>
        <AuthContext.Provider value={authValue()}>
          <WorkspaceContext.Provider value={workspaceValue()}>
            <ProjectContext.Provider value={projectValue()}>
              <Routes>
                <Route
                  path="/projects/:projectId"
                  element={<ProjectDetailPage />}
                />
              </Routes>
            </ProjectContext.Provider>
          </WorkspaceContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('link', { name: '查看项目任务' }),
    ).toHaveAttribute('href', `/projects/${PROJECT_A}/tasks`)
    expect(
      screen.queryByRole('link', { name: '创建任务' }),
    ).not.toBeInTheDocument()
  })

  it('普通成员加载只读看板，计数只来自已授权 summary，任务卡 deep link 稳定', async () => {
    renderTaskCenter()

    expect(
      await screen.findByRole('heading', { name: '项目任务' }),
    ).toBeInTheDocument()
    expect(screen.getByText('当前显示 3 项任务')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '创建任务' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/隐藏|无权任务/u)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '待开始' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
    const taskLink = screen.getByText(taskA.title).closest('a')
    expect(taskLink).toHaveAttribute(
      'href',
      `/projects/${PROJECT_A}/tasks/${TASK_A}`,
    )
    expect(screen.getByText('已逾期')).toBeInTheDocument()
  })

  it('切换列表复用同一任务数据并提供表格 deep link', async () => {
    const user = userEvent.setup()
    const tasks = taskValue()
    renderTaskCenter(undefined, projectValue(), tasks)
    await screen.findByText(taskA.title)

    await user.click(screen.getByRole('button', { name: '列表视图' }))

    const table = screen.getByRole('table', { name: '项目任务列表，共 3 项' })
    expect(within(table).getByText(taskA.title).closest('a')).toHaveAttribute(
      'href',
      `/projects/${PROJECT_A}/tasks/${TASK_A}`,
    )
    expect(tasks.list).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('view=list')
  })

  it('移动端列表卡片显示任务状态文字（防止 Task 3.2 验收缺口回归）', async () => {
    const user = userEvent.setup()
    renderTaskCenter()
    await screen.findByText(taskA.title)

    await user.click(screen.getByRole('button', { name: '列表视图' }))

    const mobileList = document.querySelector('.task-list-mobile')
    expect(mobileList).not.toBeNull()

    const container = within(mobileList as HTMLElement)
    // taskA.status = todo -> 待开始
    expect(container.getByText('状态：待开始')).toBeInTheDocument()
    // taskB.status = completed -> 已完成
    expect(container.getByText('状态：已完成')).toBeInTheDocument()
    // 桌面表格依旧存在且无状态 mutation（只读呈现）
    expect(
      screen.getByRole('table', { name: '项目任务列表，共 3 项' }),
    ).toBeInTheDocument()
    expect(container.getAllByText(/^状态：/u)).toHaveLength(3)
  })

  it('模块、负责人、协作人、状态、优先级和逾期筛选共享语义且可清空', async () => {
    const user = userEvent.setup()
    renderTaskCenter()
    await screen.findByText(taskA.title)

    await user.selectOptions(screen.getByLabelText('模块'), MODULE_B)
    expect(screen.getByText(taskB.title)).toBeInTheDocument()
    expect(screen.queryByText(taskA.title)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))

    await user.selectOptions(
      screen.getByLabelText('负责人'),
      FICTIONAL_APP_USER_ID,
    )
    expect(screen.getByText(taskA.title)).toBeInTheDocument()
    expect(screen.getByText(taskC.title)).toBeInTheDocument()
    expect(screen.queryByText(taskB.title)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))

    await user.selectOptions(screen.getByLabelText('协作人'), MEMBER_ID)
    expect(screen.getByText(taskA.title)).toBeInTheDocument()
    expect(screen.queryByText(taskC.title)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))

    await user.selectOptions(screen.getByLabelText('状态'), 'completed')
    expect(screen.getByText(taskB.title)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))

    await user.selectOptions(screen.getByLabelText('优先级'), 'high')
    expect(screen.getByText(taskA.title)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))

    await user.click(screen.getByLabelText('仅看已逾期'))
    expect(screen.getByText(taskA.title)).toBeInTheDocument()
    expect(screen.queryByText(taskB.title)).not.toBeInTheDocument()
    expect(screen.queryByText(taskC.title)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))
    expect(screen.getByText('当前显示 3 项任务')).toBeInTheDocument()
  })

  it('URL query 初始化/恢复视图筛选，修改同步 URL，非法参数 fail safe', async () => {
    const user = userEvent.setup()
    const first = renderTaskCenter(
      `/projects/${PROJECT_A}/tasks?view=list&status=completed`,
    )
    expect(await screen.findAllByText(taskB.title)).toHaveLength(2)
    expect(screen.queryByText(taskA.title)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.selectOptions(screen.getByLabelText('优先级'), 'low')
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('priority=low')
    first.unmount()

    renderTaskCenter(
      `/projects/${PROJECT_A}/tasks?view=drag&module=foreign&assignee=forged&status=secret&priority=critical&overdue=false`,
    )
    expect(await screen.findByText('当前显示 3 项任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '看板视图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('区分无任务与筛选无结果空状态', async () => {
    const empty = renderTaskCenter(
      `/projects/${PROJECT_A}/tasks`,
      projectValue(),
      taskValue([]),
    )
    expect(
      await screen.findByRole('heading', { name: '当前暂无任务' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '清空筛选' }),
    ).not.toBeInTheDocument()
    empty.unmount()

    renderTaskCenter(
      `/projects/${PROJECT_A}/tasks?status=cancelled`,
      projectValue(),
      taskValue(),
    )
    expect(
      await screen.findByRole('heading', {
        name: '没有符合当前筛选条件的任务',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '清空筛选' })).toHaveLength(2)
  })

  it('项目 A 列表迟到不能覆盖已返回的项目 B', async () => {
    const deferred = createDeferred<{
      ok: true
      data: TaskSummary[]
    }>()
    const taskForB: TaskSummary = {
      ...taskA,
      task_id: 'cccccccc-4444-4444-8444-444444444444',
      project_id: PROJECT_B,
      title: '虚构项目乙任务',
    }
    const projects = projectValue({
      get: vi.fn(async (projectId: string) => ({
        ok: true as const,
        data: projectId === PROJECT_A ? projectA : projectB,
      })),
      listModules: vi.fn(async (projectId: string) => ({
        ok: true as const,
        data: [
          makeModule(
            projectId,
            MODULE_A,
            projectId === PROJECT_A ? '虚构模块甲' : '虚构模块乙项目',
            0,
          ),
        ],
      })),
    })
    const tasks = taskValue([], {
      list: vi.fn((input) =>
        input.projectId === PROJECT_A
          ? deferred.promise
          : Promise.resolve({ ok: true as const, data: [taskForB] }),
      ),
    })
    const user = userEvent.setup()
    renderTaskCenter(undefined, projects, tasks)

    await waitFor(() =>
      expect(tasks.list).toHaveBeenCalledWith({
        projectId: PROJECT_A,
        workspaceId: FICTIONAL_WORKSPACE_ID,
      }),
    )
    await user.click(screen.getByRole('link', { name: '切换项目' }))
    expect(await screen.findByText(taskForB.title)).toBeInTheDocument()

    await act(async () => deferred.resolve({ ok: true, data: [taskA] }))
    expect(screen.getByText(taskForB.title)).toBeInTheDocument()
    expect(screen.queryByText(taskA.title)).not.toBeInTheDocument()
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
