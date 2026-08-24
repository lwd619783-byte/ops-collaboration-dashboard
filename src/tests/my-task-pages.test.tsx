import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import type { Project } from '@/features/projects'
import type { ProjectServiceResult } from '@/features/projects/projectService'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { MyTaskSummary } from '@/features/tasks'
import type { TaskServiceResult } from '@/features/tasks/taskService'
import {
  TaskContext,
  type TaskContextValue,
} from '@/features/tasks/TaskContext'
import type { WorkspaceSummary } from '@/features/workspaces'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import { HomePage } from '@/pages/HomePage'
import { MyTasksPage } from '@/pages/MyTasksPage'
import {
  fictionalAppUser,
  fictionalProfile,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const WORKSPACE_B = 'f2000000-0000-4000-8000-000000000002'
const PROJECT_ID = 'a3000000-0000-4000-8000-000000000001'
const PROJECT_B = 'a3000000-0000-4000-8000-000000000002'
const MODULE_ID = 'b3000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = 'd3000000-0000-4000-8000-000000000001'

const workspaceA: WorkspaceSummary = {
  workspace_id: FICTIONAL_WORKSPACE_ID,
  workspace_name: '虚构工作空间甲',
  role: 'member',
  status: 'active',
  joined_at: '2026-08-01T00:00:00+00:00',
}
const workspaceB: WorkspaceSummary = {
  ...workspaceA,
  workspace_id: WORKSPACE_B,
  workspace_name: '虚构工作空间乙',
}

function makeTask(
  taskId: string,
  title: string,
  overrides: Partial<MyTaskSummary> = {},
): MyTaskSummary {
  return {
    task_id: taskId,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    project_id: PROJECT_ID,
    project_name: '虚构工作台项目',
    module_id: MODULE_ID,
    module_name: '虚构工作模块',
    title,
    status: 'todo',
    priority: 'medium',
    progress: 0,
    start_date: null,
    due_date: '2026-08-28',
    updated_at: '2026-08-24T01:00:00+00:00',
    assignee_id: FICTIONAL_APP_USER_ID,
    assignee_display_name: '虚构当前成员',
    reviewer_id: OTHER_USER_ID,
    reviewer_display_name: '虚构验收成员',
    collaborators: [],
    is_assignee: true,
    is_collaborator: false,
    is_reviewer: false,
    can_decide_review: false,
    ...overrides,
  }
}

const assignedTodo = makeTask(
  'c3000000-0000-4000-8000-000000000001',
  '虚构待开始负责人任务',
)
const collaborating = makeTask(
  'c3000000-0000-4000-8000-000000000002',
  '虚构进行中协作任务',
  {
    status: 'in_progress',
    progress: 40,
    assignee_id: OTHER_USER_ID,
    is_assignee: false,
    is_collaborator: true,
    collaborators: [
      { app_user_id: FICTIONAL_APP_USER_ID, display_name: '虚构当前成员' },
    ],
  },
)
const pendingReview = makeTask(
  'c3000000-0000-4000-8000-000000000003',
  '虚构真正待我验收任务',
  {
    status: 'pending_review',
    progress: 100,
    assignee_id: OTHER_USER_ID,
    is_assignee: false,
    can_decide_review: true,
  },
)
const submittedForOtherReviewer = makeTask(
  'c3000000-0000-4000-8000-000000000004',
  '虚构已提交待他人验收任务',
  { status: 'pending_review', progress: 100 },
)
const completed = makeTask(
  'c3000000-0000-4000-8000-000000000005',
  '虚构已完成任务',
  { status: 'completed', progress: 100 },
)
const allTasks = [
  assignedTodo,
  collaborating,
  pendingReview,
  submittedForOtherReviewer,
  completed,
]

function makeProject(
  projectId: string,
  workspaceId: string,
  name: string,
): Project {
  return {
    project_id: projectId,
    workspace_id: workspaceId,
    name,
    description: null,
    project_type: 'operations',
    status: 'active',
    owner_id: OTHER_USER_ID,
    owner_display_name: '虚构项目负责人',
    lead_id: null,
    lead_display_name: null,
    start_date: null,
    due_date: '2026-09-01',
    created_by: OTHER_USER_ID,
    created_at: '2026-08-20T01:00:00+00:00',
    updated_at: '2026-08-24T02:00:00+00:00',
    archived_at: null,
  }
}

const projectA = makeProject(PROJECT_ID, FICTIONAL_WORKSPACE_ID, '虚构项目甲')
const projectB = makeProject(PROJECT_B, WORKSPACE_B, '虚构项目乙')
const unavailable = {
  ok: false as const,
  error: { code: 'permission_denied' as const, message: '不可用' },
}

function taskSuccess(
  data: MyTaskSummary[],
): TaskServiceResult<MyTaskSummary[]> {
  return { ok: true, data }
}

function taskFailure(message: string): TaskServiceResult<MyTaskSummary[]> {
  return {
    ok: false,
    error: { code: 'network_unavailable', message },
  }
}

function projectSuccess(data: Project[]): ProjectServiceResult<Project[]> {
  return { ok: true, data }
}

function projectFailure(message: string): ProjectServiceResult<Project[]> {
  return {
    ok: false,
    error: { code: 'network_unavailable', message },
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

function workspaceValue(
  currentWorkspace: WorkspaceSummary,
): WorkspaceContextValue {
  return {
    status: 'ready',
    workspaces: [currentWorkspace],
    currentWorkspace,
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

function taskValue(listMine: TaskContextValue['listMine']): TaskContextValue {
  return {
    get: vi.fn(async () => unavailable),
    list: vi.fn(async () => unavailable),
    listMine,
    listCandidates: vi.fn(async () => unavailable),
    create: vi.fn(async () => unavailable),
    update: vi.fn(async () => unavailable),
    start: vi.fn(async () => unavailable),
    block: vi.fn(async () => unavailable),
    resume: vi.fn(async () => unavailable),
    cancel: vi.fn(async () => unavailable),
    listStatusHistory: vi.fn(async () => unavailable),
    listUpdates: vi.fn(async () => unavailable),
    createProgressUpdate: vi.fn(async () => unavailable),
    listReviews: vi.fn(async () => unavailable),
    submitReview: vi.fn(async () => unavailable),
    approveReview: vi.fn(async () => unavailable),
    returnReview: vi.fn(async () => unavailable),
  }
}

function projectValue(list: ProjectContextValue['list']): ProjectContextValue {
  return {
    list,
    get: vi.fn(async () => unavailable),
    create: vi.fn(async () => unavailable),
    update: vi.fn(async () => unavailable),
    archive: vi.fn(async () => unavailable),
    listMembers: vi.fn(async () => unavailable),
    listModules: vi.fn(async () => unavailable),
    addModule: vi.fn(async () => unavailable),
    renameModule: vi.fn(async () => unavailable),
    reorderModules: vi.fn(async () => unavailable),
    deleteModule: vi.fn(async () => unavailable),
    listMemberCandidates: vi.fn(async () => unavailable),
    addMember: vi.fn(async () => unavailable),
    setMemberRole: vi.fn(async () => unavailable),
    removeMember: vi.fn(async () => unavailable),
    setLead: vi.fn(async () => unavailable),
    clearLead: vi.fn(async () => unavailable),
    transferOwner: vi.fn(async () => unavailable),
  }
}

function Providers({
  children,
  currentWorkspace,
  projects,
  tasks,
}: {
  children: React.ReactNode
  currentWorkspace: WorkspaceSummary
  projects: ProjectContextValue
  tasks: TaskContextValue
}) {
  return (
    <AuthContext.Provider value={authValue()}>
      <WorkspaceContext.Provider value={workspaceValue(currentWorkspace)}>
        <ProjectContext.Provider value={projects}>
          <TaskContext.Provider value={tasks}>{children}</TaskContext.Provider>
        </ProjectContext.Provider>
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <p>当前位置：{location.pathname}</p>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderHome(
  taskContext: TaskContextValue,
  projectContext: ProjectContextValue,
  currentWorkspace = workspaceA,
) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Providers
        currentWorkspace={currentWorkspace}
        projects={projectContext}
        tasks={taskContext}
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<LocationProbe />} />
          <Route path="/projects" element={<LocationProbe />} />
          <Route
            path="/projects/:projectId/tasks/:taskId"
            element={<LocationProbe />}
          />
        </Routes>
      </Providers>
    </MemoryRouter>,
  )
}

function renderMyTasks(
  taskContext: TaskContextValue,
  currentWorkspace = workspaceA,
) {
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <Providers
        currentWorkspace={currentWorkspace}
        projects={projectValue(vi.fn(async () => projectSuccess([])))}
        tasks={taskContext}
      >
        <Routes>
          <Route path="/tasks" element={<MyTasksPage />} />
          <Route
            path="/projects/:projectId/tasks/:taskId"
            element={<LocationProbe />}
          />
        </Routes>
      </Providers>
    </MemoryRouter>,
  )
}

describe('首页工作台', () => {
  it('分别呈现 loading，并允许任务失败而项目成功', async () => {
    const taskRequest = deferred<TaskServiceResult<MyTaskSummary[]>>()
    const projectRequest =
      deferred<Awaited<ReturnType<ProjectContextValue['list']>>>()
    const tasks = taskValue(vi.fn(() => taskRequest.promise))
    const projects = projectValue(vi.fn(() => projectRequest.promise))
    renderHome(tasks, projects)

    expect(screen.getByText('正在加载待处理任务')).toBeInTheDocument()
    expect(screen.getByText('正在加载项目')).toBeInTheDocument()

    await act(async () => {
      taskRequest.resolve(taskFailure('任务网络暂时不可用。'))
      projectRequest.resolve(projectSuccess([projectA]))
    })
    expect(await screen.findByText('任务网络暂时不可用。')).toBeInTheDocument()
    expect(screen.getByText('虚构项目甲')).toBeInTheDocument()
  })

  it('全失败时显示两个可重试错误区，不白屏', async () => {
    renderHome(
      taskValue(vi.fn(async () => taskFailure('任务读取失败。'))),
      projectValue(vi.fn(async () => projectFailure('项目读取失败。'))),
    )
    expect(await screen.findByText('任务读取失败。')).toBeInTheDocument()
    expect(await screen.findByText('项目读取失败。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument()
  })

  it('任务和项目为空时分别显示业务空状态', async () => {
    renderHome(
      taskValue(vi.fn(async () => taskSuccess([]))),
      projectValue(vi.fn(async () => projectSuccess([]))),
    )
    expect(await screen.findByText('暂无待处理事项')).toBeInTheDocument()
    expect(await screen.findByText('暂无项目')).toBeInTheDocument()
  })

  it('任务、项目和两个查看全部入口都指向正式路由', async () => {
    const user = userEvent.setup()
    renderHome(
      taskValue(vi.fn(async () => taskSuccess([assignedTodo]))),
      projectValue(vi.fn(async () => projectSuccess([projectA]))),
    )
    const taskLink = await screen.findByRole('link', {
      name: assignedTodo.title,
    })
    expect(taskLink).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/tasks/${assignedTodo.task_id}`,
    )
    expect(screen.getByRole('link', { name: '查看全部任务' })).toHaveAttribute(
      'href',
      '/tasks',
    )
    expect(screen.getByRole('link', { name: '查看全部项目' })).toHaveAttribute(
      'href',
      '/projects',
    )
    await user.click(taskLink)
    expect(
      screen.getByText(
        `当前位置：/projects/${PROJECT_ID}/tasks/${assignedTodo.task_id}`,
      ),
    ).toBeInTheDocument()
  })

  it('workspace 切换时项目分块也丢弃旧请求的晚到结果', async () => {
    const requestA = deferred<ProjectServiceResult<Project[]>>()
    const requestB = deferred<ProjectServiceResult<Project[]>>()
    const listProjects = vi
      .fn<ProjectContextValue['list']>()
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise)
    const tasks = taskValue(vi.fn(async () => taskSuccess([])))
    const projects = projectValue(listProjects)
    const view = renderHome(tasks, projects, workspaceA)
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1))

    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Providers
          currentWorkspace={workspaceB}
          projects={projects}
          tasks={tasks}
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
    await act(async () => {
      requestB.resolve(projectSuccess([projectB]))
    })
    expect(await screen.findByText(projectB.name)).toBeInTheDocument()
    await act(async () => {
      requestA.resolve(projectSuccess([projectA]))
    })
    expect(screen.queryByText(projectA.name)).toBeNull()
    expect(screen.getByText(projectB.name)).toBeInTheDocument()
  })
})

describe('我的任务页面', () => {
  it('/tasks 是正式页面，各筛选保持责任语义且待我验收不含已提交任务', async () => {
    const user = userEvent.setup()
    renderMyTasks(taskValue(vi.fn(async () => taskSuccess(allTasks))))

    expect(
      await screen.findByRole('heading', { name: '我的任务' }),
    ).toBeInTheDocument()
    expect(screen.getByText(assignedTodo.title)).toBeInTheDocument()
    expect(screen.getByText(collaborating.title)).toBeInTheDocument()
    expect(screen.getByText(pendingReview.title)).toBeInTheDocument()
    expect(screen.queryByText(submittedForOtherReviewer.title)).toBeNull()
    expect(screen.queryByText(completed.title)).toBeNull()

    await user.click(screen.getByRole('button', { name: '我负责' }))
    expect(screen.getByText(assignedTodo.title)).toBeInTheDocument()
    expect(
      screen.getByText(submittedForOtherReviewer.title),
    ).toBeInTheDocument()
    expect(screen.queryByText(collaborating.title)).toBeNull()

    await user.click(screen.getByRole('button', { name: '我协作' }))
    expect(screen.getByText(collaborating.title)).toBeInTheDocument()
    expect(screen.queryByText(assignedTodo.title)).toBeNull()

    await user.click(screen.getByRole('button', { name: '待我验收' }))
    expect(screen.getByText(pendingReview.title)).toBeInTheDocument()
    expect(screen.queryByText(submittedForOtherReviewer.title)).toBeNull()

    await user.click(screen.getByRole('button', { name: '已完成' }))
    expect(screen.getByText(completed.title)).toBeInTheDocument()
    expect(screen.queryByText(pendingReview.title)).toBeNull()
  })

  it('当前筛选没有结果时显示明确空状态', async () => {
    const user = userEvent.setup()
    renderMyTasks(taskValue(vi.fn(async () => taskSuccess([assignedTodo]))))
    await screen.findByText(assignedTodo.title)
    await user.click(screen.getByRole('button', { name: '已完成' }))
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    expect(screen.getByText(/“已完成”/u)).toBeInTheDocument()
  })

  it('workspace 切换时丢弃旧请求的晚到结果', async () => {
    const requestA = deferred<TaskServiceResult<MyTaskSummary[]>>()
    const requestB = deferred<TaskServiceResult<MyTaskSummary[]>>()
    const listMine = vi
      .fn<TaskContextValue['listMine']>()
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise)
    const tasks = taskValue(listMine)
    const view = renderMyTasks(tasks, workspaceA)
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(1))

    view.rerender(
      <MemoryRouter initialEntries={['/tasks']}>
        <Providers
          currentWorkspace={workspaceB}
          projects={projectValue(vi.fn(async () => projectSuccess([])))}
          tasks={tasks}
        >
          <Routes>
            <Route path="/tasks" element={<MyTasksPage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2))
    const taskB = makeTask(
      'c3000000-0000-4000-8000-000000000010',
      '虚构工作空间乙任务',
      { workspace_id: WORKSPACE_B, project_id: PROJECT_B },
    )
    await act(async () => {
      requestB.resolve(taskSuccess([taskB]))
    })
    expect(await screen.findByText(taskB.title)).toBeInTheDocument()
    await act(async () => {
      requestA.resolve(taskSuccess([assignedTodo]))
    })
    expect(screen.queryByText(assignedTodo.title)).toBeNull()
    expect(screen.getByText(taskB.title)).toBeInTheDocument()
  })

  it('workspace role 改变时旧 scope 的结果不得显示', async () => {
    const oldRoleRequest = deferred<TaskServiceResult<MyTaskSummary[]>>()
    const newRoleRequest = deferred<TaskServiceResult<MyTaskSummary[]>>()
    const listMine = vi
      .fn<TaskContextValue['listMine']>()
      .mockImplementationOnce(() => oldRoleRequest.promise)
      .mockImplementationOnce(() => newRoleRequest.promise)
    const tasks = taskValue(listMine)
    const view = renderMyTasks(tasks, workspaceA)
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(1))

    view.rerender(
      <MemoryRouter initialEntries={['/tasks']}>
        <Providers
          currentWorkspace={{ ...workspaceA, role: 'admin' }}
          projects={projectValue(vi.fn(async () => projectSuccess([])))}
          tasks={tasks}
        >
          <Routes>
            <Route path="/tasks" element={<MyTasksPage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2))
    await act(async () => {
      oldRoleRequest.resolve(taskSuccess([assignedTodo]))
      newRoleRequest.resolve(taskSuccess([pendingReview]))
    })
    expect(await screen.findByText(pendingReview.title)).toBeInTheDocument()
    expect(screen.queryByText(assignedTodo.title)).toBeNull()
  })
})
