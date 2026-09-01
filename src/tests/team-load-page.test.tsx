import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import type { Project, ProjectMember } from '@/features/projects'
import type { ProjectServiceResult } from '@/features/projects/projectService'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { TaskSummary } from '@/features/tasks'
import {
  TaskContext,
  type TaskContextValue,
} from '@/features/tasks/TaskContext'
import type { WorkspaceSummary } from '@/features/workspaces'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import { TeamLoadPage } from '@/pages/TeamLoadPage'
import {
  fictionalAppUser,
  fictionalProfile,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const WORKSPACE_B = '90000000-0000-4000-8000-000000000002'
const PROJECT_A = 'a0000000-0000-4000-8000-000000000001'
const PROJECT_B = 'a0000000-0000-4000-8000-000000000002'
const MEMBER_B = 'b0000000-0000-4000-8000-000000000002'
const MEMBER_C = 'b0000000-0000-4000-8000-000000000003'
const OTHER_USER_ID = 'b0000000-0000-4000-8000-000000000009'
const MODULE_ID = 'c0000000-0000-4000-8000-000000000001'

const workspaceA: WorkspaceSummary = {
  workspace_id: FICTIONAL_WORKSPACE_ID,
  workspace_name: '虚构负荷空间甲',
  role: 'owner',
  status: 'active',
  joined_at: '2026-08-01T00:00:00Z',
}
const workspaceB: WorkspaceSummary = {
  ...workspaceA,
  workspace_id: WORKSPACE_B,
  workspace_name: '虚构负荷空间乙',
}

function project(
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
    owner_id: FICTIONAL_APP_USER_ID,
    owner_display_name: '虚构负责人甲',
    lead_id: null,
    lead_display_name: null,
    start_date: null,
    due_date: null,
    created_by: FICTIONAL_APP_USER_ID,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

const projectA = project(PROJECT_A, FICTIONAL_WORKSPACE_ID, '虚构负荷项目甲')
const projectB = project(PROJECT_B, WORKSPACE_B, '虚构负荷项目乙')

function member(
  projectId: string,
  workspaceId: string,
  appUserId: string,
  displayName: string,
  isActive = true,
): ProjectMember {
  return {
    project_id: projectId,
    workspace_id: workspaceId,
    app_user_id: appUserId,
    display_name: displayName,
    project_role: 'member',
    workspace_role: 'member',
    joined_at: '2026-08-01T00:00:00Z',
    is_current_user: appUserId === FICTIONAL_APP_USER_ID,
    is_active: isActive,
    active_member_count: isActive ? 1 : 0,
    inactive_historical_member_count: isActive ? 0 : 1,
  }
}

function task(
  taskId: string,
  projectId: string,
  workspaceId: string,
  assigneeId: string,
  overrides: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    task_id: taskId,
    project_id: projectId,
    workspace_id: workspaceId,
    module_id: MODULE_ID,
    module_name: '虚构负荷模块',
    title: `虚构负荷任务 ${taskId.slice(-1)}`,
    assignee_id: assigneeId,
    assignee_display_name: '虚构执行负责人',
    collaborators: [],
    priority: 'medium',
    start_date: null,
    due_date: null,
    estimated_hours: null,
    workload_level: 'm',
    visibility: 'project',
    status: 'todo',
    progress: 0,
    updated_at: '2026-08-31T12:00:00Z',
    ...overrides,
  }
}

const unavailable = {
  ok: false as const,
  error: { code: 'permission_denied' as const, message: '虚构不可用' },
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

function projectValue(
  list: ProjectContextValue['list'],
  listMembers: ProjectContextValue['listMembers'] = vi.fn(
    async () => unavailable,
  ),
): ProjectContextValue {
  return {
    list,
    listMembers,
    get: vi.fn(async () => unavailable),
    create: vi.fn(async () => unavailable),
    update: vi.fn(async () => unavailable),
    archive: vi.fn(async () => unavailable),
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
    list,
    get: vi.fn(async () => unavailable),
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

function renderTeamLoad(
  projects: ProjectContextValue,
  tasks: TaskContextValue,
  currentWorkspace = workspaceA,
) {
  return render(
    <MemoryRouter initialEntries={['/team-load']}>
      <Providers
        currentWorkspace={currentWorkspace}
        projects={projects}
        tasks={tasks}
      >
        <Routes>
          <Route path="/team-load" element={<TeamLoadPage />} />
        </Routes>
      </Providers>
    </MemoryRouter>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function projectSuccess(data: Project[]): ProjectServiceResult<Project[]> {
  return { ok: true, data }
}

describe('团队负荷页面', () => {
  it('项目列表读取期间显示 loading，失败后显示可重试页面级 error', async () => {
    const request = deferred<ProjectServiceResult<Project[]>>()
    renderTeamLoad(
      projectValue(vi.fn(() => request.promise)),
      taskValue(vi.fn(async () => unavailable)),
    )
    expect(await screen.findByText('正在加载团队负荷')).toBeInTheDocument()
    await act(async () => request.resolve(unavailable))
    expect(await screen.findByText('暂时无法加载团队负荷')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('普通成员没有 manageable project 时显示安全空状态且不读取 bundle', async () => {
    const listMembers = vi.fn<ProjectContextValue['listMembers']>()
    const listTasks = vi.fn<TaskContextValue['list']>()
    renderTeamLoad(
      projectValue(
        vi.fn(async () =>
          projectSuccess([
            project(
              'a0000000-0000-4000-8000-000000000009',
              FICTIONAL_WORKSPACE_ID,
              '虚构普通可见项目',
              { owner_id: OTHER_USER_ID },
            ),
          ]),
        ),
        listMembers,
      ),
      taskValue(listTasks),
      { ...workspaceA, role: 'member' },
    )
    expect(await screen.findByText('当前没有可管理的项目')).toBeInTheDocument()
    expect(listMembers).not.toHaveBeenCalled()
    expect(listTasks).not.toHaveBeenCalled()
  })

  it('展示摘要、成员直接原因、估算覆盖度、0 任务 active member 与非绩效声明', async () => {
    const members = [
      member(
        PROJECT_A,
        FICTIONAL_WORKSPACE_ID,
        FICTIONAL_APP_USER_ID,
        '虚构成员甲',
      ),
      member(PROJECT_A, FICTIONAL_WORKSPACE_ID, MEMBER_C, '虚构成员丙'),
      member(
        PROJECT_A,
        FICTIONAL_WORKSPACE_ID,
        MEMBER_B,
        '虚构历史成员',
        false,
      ),
    ]
    const tasks = [
      task(
        'd0000000-0000-4000-8000-000000000001',
        PROJECT_A,
        FICTIONAL_WORKSPACE_ID,
        FICTIONAL_APP_USER_ID,
        {
          priority: 'urgent',
          status: 'blocked',
          due_date: '2000-01-01',
          estimated_hours: 10,
          progress: 50,
        },
      ),
      task(
        'd0000000-0000-4000-8000-000000000002',
        PROJECT_A,
        FICTIONAL_WORKSPACE_ID,
        FICTIONAL_APP_USER_ID,
        { estimated_hours: null },
      ),
      task(
        'd0000000-0000-4000-8000-000000000003',
        PROJECT_A,
        FICTIONAL_WORKSPACE_ID,
        FICTIONAL_APP_USER_ID,
        { status: 'pending_review', estimated_hours: 99 },
      ),
    ]
    renderTeamLoad(
      projectValue(
        vi.fn(async () => projectSuccess([projectA])),
        vi.fn(async () => ({ ok: true as const, data: members })),
      ),
      taskValue(vi.fn(async () => ({ ok: true as const, data: tasks }))),
    )

    expect(await screen.findByText('团队摘要')).toBeInTheDocument()
    expect(screen.getByText(/不是绩效评价/u)).toBeInTheDocument()
    expect(screen.getByText(/协作负荷与验收负荷暂未纳入/u)).toBeInTheDocument()
    expect(
      screen.getByText('已知 5h · 覆盖 1/2 个执行任务'),
    ).toBeInTheDocument()
    expect(screen.getByText('1 个高优先级')).toBeInTheDocument()
    expect(screen.getByText('1 个阻塞')).toBeInTheDocument()
    expect(screen.getByText('1 个逾期')).toBeInTheDocument()
    const zeroTaskCard = screen.getByText('虚构成员丙').closest('article')
    expect(zeroTaskCard).not.toBeNull()
    expect(
      within(zeroTaskCard as HTMLElement).getAllByText('当前无执行任务').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('虚构历史成员')).not.toBeInTheDocument()
    expect(screen.getByText(/不代表绩效排序/u)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '返回管理工作台' }),
    ).toHaveAttribute('href', '/management')
  })

  it('partial failure 明示加载范围，重试只恢复失败 bundle', async () => {
    const user = userEvent.setup()
    const localProjectB = project(
      PROJECT_B,
      FICTIONAL_WORKSPACE_ID,
      '虚构负荷项目乙',
    )
    let projectBAttempts = 0
    const listMembers = vi.fn(async (projectId: string) => {
      if (projectId === PROJECT_B) {
        projectBAttempts += 1
        if (projectBAttempts === 1) return unavailable
        return {
          ok: true as const,
          data: [
            member(PROJECT_B, FICTIONAL_WORKSPACE_ID, MEMBER_C, '虚构成员丙'),
          ],
        }
      }
      return {
        ok: true as const,
        data: [
          member(
            PROJECT_A,
            FICTIONAL_WORKSPACE_ID,
            FICTIONAL_APP_USER_ID,
            '虚构成员甲',
          ),
        ],
      }
    })
    const listTasks = vi.fn(async ({ projectId }: { projectId: string }) => ({
      ok: true as const,
      data:
        projectId === PROJECT_A
          ? [
              task(
                'd0000000-0000-4000-8000-000000000004',
                PROJECT_A,
                FICTIONAL_WORKSPACE_ID,
                FICTIONAL_APP_USER_ID,
              ),
            ]
          : [],
    }))
    renderTeamLoad(
      projectValue(
        vi.fn(async () => projectSuccess([projectA, localProjectB])),
        listMembers,
      ),
      taskValue(listTasks),
    )

    expect(await screen.findByText(/PARTIAL DATA/u)).toBeInTheDocument()
    expect(screen.getByText(/已加载 1 \/ 2 个可管理项目/u)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试失败项目' }))
    await waitFor(() =>
      expect(screen.queryByText(/PARTIAL DATA/u)).not.toBeInTheDocument(),
    )
    expect(listMembers).toHaveBeenCalledTimes(3)
    expect(listTasks).toHaveBeenCalledTimes(3)
    expect(screen.getByText('虚构成员丙')).toBeInTheDocument()
  })

  it('全部 bundle 失败时显示 unavailable，绝不显示团队 0 任务', async () => {
    renderTeamLoad(
      projectValue(
        vi.fn(async () => projectSuccess([projectA])),
        vi.fn(async () => unavailable),
      ),
      taskValue(vi.fn(async () => unavailable)),
    )
    expect(
      await screen.findByText('团队负荷数据暂时不可用'),
    ).toBeInTheDocument()
    expect(screen.getByText(/0 \/ 1 个可管理项目成功加载/u)).toBeInTheDocument()
    expect(
      screen.queryByText('当前执行任务', { selector: 'span' }),
    ).not.toBeInTheDocument()
  })

  it('orphan execution assignee 使项目 bundle invalid，而不是静默漏算', async () => {
    renderTeamLoad(
      projectValue(
        vi.fn(async () => projectSuccess([projectA])),
        vi.fn(async () => ({
          ok: true as const,
          data: [
            member(
              PROJECT_A,
              FICTIONAL_WORKSPACE_ID,
              FICTIONAL_APP_USER_ID,
              '虚构成员甲',
            ),
          ],
        })),
      ),
      taskValue(
        vi.fn(async () => ({
          ok: true as const,
          data: [
            task(
              'd0000000-0000-4000-8000-000000000005',
              PROJECT_A,
              FICTIONAL_WORKSPACE_ID,
              MEMBER_C,
            ),
          ],
        })),
      ),
    )
    expect(
      await screen.findByText('团队负荷数据暂时不可用'),
    ).toBeInTheDocument()
  })

  it('workspace switch 后丢弃旧 scope 的晚到项目结果', async () => {
    const requestA = deferred<ProjectServiceResult<Project[]>>()
    const requestB = deferred<ProjectServiceResult<Project[]>>()
    const listProjects = vi
      .fn<ProjectContextValue['list']>()
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise)
    const listMembers = vi.fn(async (projectId: string) => ({
      ok: true as const,
      data: [
        member(
          projectId,
          projectId === PROJECT_B ? WORKSPACE_B : FICTIONAL_WORKSPACE_ID,
          FICTIONAL_APP_USER_ID,
          projectId === PROJECT_B ? '虚构空间乙成员' : '虚构空间甲成员',
        ),
      ],
    }))
    const projects = projectValue(listProjects, listMembers)
    const tasks = taskValue(
      vi.fn(async () => ({ ok: true as const, data: [] })),
    )
    const view = renderTeamLoad(projects, tasks, workspaceA)
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1))

    view.rerender(
      <MemoryRouter initialEntries={['/team-load']}>
        <Providers
          currentWorkspace={workspaceB}
          projects={projects}
          tasks={tasks}
        >
          <Routes>
            <Route path="/team-load" element={<TeamLoadPage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
    await act(async () => requestB.resolve(projectSuccess([projectB])))
    expect(await screen.findByText('虚构空间乙成员')).toBeInTheDocument()
    await act(async () => requestA.resolve(projectSuccess([projectA])))
    expect(screen.queryByText('虚构空间甲成员')).not.toBeInTheDocument()
    expect(screen.getByText('虚构空间乙成员')).toBeInTheDocument()
  })
})
