import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import type { Project } from '@/features/projects'
import type { ProjectServiceResult } from '@/features/projects/projectService'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { TaskSummary } from '@/features/tasks'
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
import { ManagementWorkbenchPage } from '@/pages/ManagementWorkbenchPage'
import {
  fictionalAppUser,
  fictionalProfile,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const WORKSPACE_B = '90000000-0000-4000-8000-000000000002'
const PROJECT_A = 'a0000000-0000-4000-8000-000000000001'
const PROJECT_B = 'a0000000-0000-4000-8000-000000000002'
const MODULE_ID = 'b0000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = 'd0000000-0000-4000-8000-000000000001'

const workspaceA: WorkspaceSummary = {
  workspace_id: FICTIONAL_WORKSPACE_ID,
  workspace_name: '虚构管理空间甲',
  role: 'owner',
  status: 'active',
  joined_at: '2026-08-01T00:00:00Z',
}
const workspaceB: WorkspaceSummary = {
  ...workspaceA,
  workspace_id: WORKSPACE_B,
  workspace_name: '虚构管理空间乙',
}

function makeProject(
  projectId: string,
  workspaceId: string,
  name: string,
  overrides: Partial<Project> = {},
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
    lead_id: FICTIONAL_APP_USER_ID,
    lead_display_name: '虚构项目牵头人',
    start_date: null,
    due_date: '2999-01-01',
    created_by: OTHER_USER_ID,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

const projectA = makeProject(
  PROJECT_A,
  FICTIONAL_WORKSPACE_ID,
  '虚构高风险项目甲',
)
const projectB = makeProject(PROJECT_B, WORKSPACE_B, '虚构正常项目乙')

function makeTask(
  taskId: string,
  projectId: string,
  workspaceId: string,
  title: string,
  overrides: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    task_id: taskId,
    project_id: projectId,
    workspace_id: workspaceId,
    module_id: MODULE_ID,
    module_name: '虚构管理模块',
    title,
    assignee_id: OTHER_USER_ID,
    assignee_display_name: '虚构任务负责人',
    collaborators: [],
    priority: 'high',
    start_date: null,
    due_date: null,
    estimated_hours: null,
    workload_level: 'm',
    visibility: 'project',
    status: 'todo',
    progress: 20,
    updated_at: '2026-08-25T08:00:00Z',
    ...overrides,
  }
}

const overdueTask = makeTask(
  'c0000000-0000-4000-8000-000000000001',
  PROJECT_A,
  FICTIONAL_WORKSPACE_ID,
  '虚构逾期任务',
  { due_date: '2000-01-01' },
)
const blockedTask = makeTask(
  'c0000000-0000-4000-8000-000000000002',
  PROJECT_A,
  FICTIONAL_WORKSPACE_ID,
  '虚构阻塞任务',
  { status: 'blocked', progress: 35, updated_at: '2026-08-25T09:00:00Z' },
)
const reviewTask = makeTask(
  'c0000000-0000-4000-8000-000000000003',
  PROJECT_A,
  FICTIONAL_WORKSPACE_ID,
  '虚构待验收任务',
  { status: 'pending_review', progress: 100 },
)
const staleTask = makeTask(
  'c0000000-0000-4000-8000-000000000004',
  PROJECT_A,
  FICTIONAL_WORKSPACE_ID,
  '虚构长期未更新任务',
  { updated_at: '2000-01-01T00:00:00Z' },
)

const unavailable = {
  ok: false as const,
  error: { code: 'permission_denied' as const, message: '不可用' },
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

function taskValue(list: TaskContextValue['list']): TaskContextValue {
  return {
    get: vi.fn(async () => unavailable),
    list,
    listMine: vi.fn(async () => unavailable),
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

function renderManagement(
  projects: ProjectContextValue,
  tasks: TaskContextValue,
  currentWorkspace = workspaceA,
) {
  return render(
    <MemoryRouter initialEntries={['/management']}>
      <Providers
        currentWorkspace={currentWorkspace}
        projects={projects}
        tasks={tasks}
      >
        <Routes>
          <Route path="/management" element={<ManagementWorkbenchPage />} />
        </Routes>
      </Providers>
    </MemoryRouter>,
  )
}

function projectSuccess(data: Project[]): ProjectServiceResult<Project[]> {
  return { ok: true, data }
}

function taskSuccess(data: TaskSummary[]): TaskServiceResult<TaskSummary[]> {
  return { ok: true, data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('管理者工作台页面', () => {
  it('项目列表读取期间显示 loading，失败时显示可重试页面级 error', async () => {
    const request = deferred<ProjectServiceResult<Project[]>>()
    const listProjects = vi.fn(() => request.promise)
    renderManagement(
      projectValue(listProjects),
      taskValue(vi.fn(async () => taskSuccess([]))),
    )
    expect(screen.getByText('正在加载管理工作台')).toBeInTheDocument()

    await act(async () => {
      request.resolve({
        ok: false,
        error: { code: 'network_unavailable', message: '虚构项目读取失败。' },
      })
    })
    expect(await screen.findByText('虚构项目读取失败。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('普通成员没有可管理项目时安全显示业务空状态', async () => {
    const unrelated = makeProject(
      PROJECT_A,
      FICTIONAL_WORKSPACE_ID,
      '虚构普通可见项目',
      { lead_id: null, lead_display_name: null },
    )
    renderManagement(
      projectValue(vi.fn(async () => projectSuccess([unrelated]))),
      taskValue(vi.fn(async () => taskSuccess([]))),
      { ...workspaceA, role: 'member' },
    )
    expect(
      await screen.findByRole('heading', { name: '当前没有可管理的项目' }),
    ).toBeInTheDocument()
  })

  it('展示真实摘要、红黄绿文字、筛选、近期更新与稳定 deep link', async () => {
    const user = userEvent.setup()
    const healthyProject = makeProject(
      'a0000000-0000-4000-8000-000000000003',
      FICTIONAL_WORKSPACE_ID,
      '虚构正常项目',
    )
    const healthyTask = makeTask(
      'c0000000-0000-4000-8000-000000000005',
      healthyProject.project_id,
      FICTIONAL_WORKSPACE_ID,
      '虚构正常任务',
      { due_date: '2999-01-01', updated_at: new Date().toISOString() },
    )
    renderManagement(
      projectValue(
        vi.fn(async () => projectSuccess([projectA, healthyProject])),
      ),
      taskValue(
        vi.fn(async ({ projectId }) =>
          taskSuccess(
            projectId === PROJECT_A
              ? [
                  { ...overdueTask, updated_at: healthyTask.updated_at },
                  { ...blockedTask, updated_at: healthyTask.updated_at },
                  { ...reviewTask, updated_at: healthyTask.updated_at },
                  staleTask,
                ]
              : [healthyTask],
          ),
        ),
      ),
    )

    expect(
      await screen.findByRole('heading', { name: '管理工作台' }),
    ).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /高风险项目 1 项/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /逾期任务 1 项/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /阻塞任务 1 项/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /待验收任务 1 项/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /长期未更新任务 1 项/u }),
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: projectA.name })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_A}`,
    )
    const overdueLinks = screen.getAllByRole('link', {
      name: overdueTask.title,
    })
    expect(overdueLinks.length).toBeGreaterThan(0)
    for (const link of overdueLinks) {
      expect(link).toHaveAttribute(
        'href',
        `/projects/${PROJECT_A}/tasks/${overdueTask.task_id}`,
      )
    }

    const attention = screen
      .getByRole('heading', { name: '重点事项' })
      .closest('section')
    expect(attention).not.toBeNull()
    const attentionView = within(attention as HTMLElement)
    await user.click(attentionView.getByRole('button', { name: '阻塞' }))
    expect(attentionView.getByText(blockedTask.title)).toBeInTheDocument()
    expect(attentionView.queryByText(overdueTask.title)).not.toBeInTheDocument()
    await user.click(attentionView.getByRole('button', { name: '待验收' }))
    expect(attentionView.getByText(reviewTask.title)).toBeInTheDocument()
    await user.click(attentionView.getByRole('button', { name: '长期未更新' }))
    expect(attentionView.getByText(staleTask.title)).toBeInTheDocument()

    const recent = screen
      .getByRole('heading', {
        name: '近期任务更新',
      })
      .closest('section')
    expect(recent).not.toBeNull()
    expect(
      within(recent as HTMLElement).getByText(healthyTask.title),
    ).toBeInTheDocument()
    expect(
      document.querySelector('.management-workbench-page table'),
    ).toBeNull()
    expect(
      document.querySelectorAll('.management-task-card').length,
    ).toBeGreaterThan(0)
  })

  it('partial failure 不清空成功项目，失败项目 unknown，重试仅恢复失败项目', async () => {
    const user = userEvent.setup()
    const failedProject = makeProject(
      'a0000000-0000-4000-8000-000000000004',
      FICTIONAL_WORKSPACE_ID,
      '虚构读取失败项目',
    )
    let failedAttempts = 0
    const listTasks = vi.fn(async ({ projectId }: { projectId: string }) => {
      if (projectId === failedProject.project_id) {
        failedAttempts += 1
        if (failedAttempts === 1) {
          return {
            ok: false as const,
            error: {
              code: 'network_unavailable' as const,
              message: '虚构任务读取失败。',
            },
          }
        }
        return taskSuccess([])
      }
      return taskSuccess([overdueTask])
    })
    renderManagement(
      projectValue(
        vi.fn(async () => projectSuccess([projectA, failedProject])),
      ),
      taskValue(listTasks),
    )

    expect(
      await screen.findByText('部分项目数据暂时无法读取'),
    ).toBeInTheDocument()
    expect(screen.getByText(/已加载 1 \/ 2 个项目/u)).toBeInTheDocument()
    expect(screen.getAllByText(projectA.name).length).toBeGreaterThan(0)
    expect(screen.getByText(failedProject.name)).toBeInTheDocument()
    expect(screen.getAllByText('数据不完整').length).toBeGreaterThan(0)
    expect(screen.getAllByText(overdueTask.title).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '重试失败项目' }))
    await waitFor(() =>
      expect(
        screen.queryByText('部分项目数据暂时无法读取'),
      ).not.toBeInTheDocument(),
    )
    expect(listTasks).toHaveBeenCalledTimes(3)
    expect(screen.getAllByText(projectA.name).length).toBeGreaterThan(0)
  })

  it('workspace switch 后丢弃旧 scope 的晚到项目结果', async () => {
    const requestA = deferred<ProjectServiceResult<Project[]>>()
    const requestB = deferred<ProjectServiceResult<Project[]>>()
    const listProjects = vi
      .fn<ProjectContextValue['list']>()
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise)
    const projects = projectValue(listProjects)
    const listTasks = vi.fn(async ({ projectId }: { projectId: string }) =>
      taskSuccess(
        projectId === PROJECT_B
          ? [
              makeTask(
                'c0000000-0000-4000-8000-000000000006',
                PROJECT_B,
                WORKSPACE_B,
                '虚构工作空间乙任务',
                { due_date: '2999-01-01' },
              ),
            ]
          : [],
      ),
    )
    const tasks = taskValue(listTasks)
    const view = renderManagement(projects, tasks, workspaceA)
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1))

    view.rerender(
      <MemoryRouter initialEntries={['/management']}>
        <Providers
          currentWorkspace={workspaceB}
          projects={projects}
          tasks={tasks}
        >
          <Routes>
            <Route path="/management" element={<ManagementWorkbenchPage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
    await act(async () => requestB.resolve(projectSuccess([projectB])))
    expect((await screen.findAllByText(projectB.name)).length).toBeGreaterThan(
      0,
    )
    await act(async () => requestA.resolve(projectSuccess([projectA])))
    expect(screen.queryByText(projectA.name)).not.toBeInTheDocument()
    expect(screen.getAllByText(projectB.name).length).toBeGreaterThan(0)
  })
})
