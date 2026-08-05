import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type { Project, ProjectCreateInput } from '@/features/projects/types'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import type { WorkspaceRole } from '@/features/workspaces/types'
import { EditProjectPage } from '@/pages/EditProjectPage'
import { NewProjectPage } from '@/pages/NewProjectPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import {
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const SECOND_PROJECT_ID = 'aaaaaaaa-2222-4222-8222-222222222222'

const currentProject: Project = {
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '虚构运维甲项目',
  description: '用于界面测试的虚构描述',
  project_type: 'operations',
  status: 'active',
  owner_id: FICTIONAL_APP_USER_ID,
  owner_display_name: '虚构负责人甲',
  lead_id: null,
  lead_display_name: null,
  start_date: '2026-08-04',
  due_date: '2026-08-20',
  created_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-04T01:00:00+00:00',
  updated_at: '2026-08-04T02:00:00+00:00',
  archived_at: null,
}

const completedProject: Project = {
  ...currentProject,
  project_id: SECOND_PROJECT_ID,
  name: '虚构已完成项目',
  status: 'completed',
}

const archivedProject: Project = {
  ...completedProject,
  status: 'archived',
  archived_at: '2026-08-04T03:00:00+00:00',
  updated_at: '2026-08-04T03:00:00+00:00',
}

function workspaceValue(role: WorkspaceRole): WorkspaceContextValue {
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
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [currentProject] })),
    get: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    create: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    update: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    archive: vi.fn(async () => ({ ok: true as const, data: archivedProject })),
    listMembers: vi.fn(async () => ({
      ok: true as const,
      data: [],
    })),
    listMemberCandidates: vi.fn(async () => ({
      ok: true as const,
      data: [],
    })),
    addMember: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    setMemberRole: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    removeMember: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    setLead: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    clearLead: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    transferOwner: vi.fn(async () => ({
      ok: true as const,
      data: { ...currentProject, changed: true },
    })),
    ...overrides,
  }
}

function renderWithContexts(
  route: string,
  element: React.ReactNode,
  role: WorkspaceRole = 'owner',
  projects: ProjectContextValue = projectValue(),
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <WorkspaceContext.Provider value={workspaceValue(role)}>
        <ProjectContext.Provider value={projects}>
          {element}
        </ProjectContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type ListResult =
  | { ok: true; data: Project[] }
  | { ok: false; error: { code: 'unknown_service_error'; message: string } }

type DetailServiceResult =
  | { ok: true; data: Project }
  | {
      ok: false
      error: {
        code:
          | 'unknown_service_error'
          | 'concurrent_update'
          | 'not_found_or_forbidden'
        message: string
      }
    }

type MutationServiceResult =
  | { ok: true; data: Project }
  | {
      ok: false
      error: {
        code: 'unknown_service_error' | 'concurrent_update'
        message: string
      }
    }

const SECOND_WORKSPACE_ID = 'bbbbbbbb-0000-4000-8000-0000000000bb'

function memberWorkspace(): WorkspaceContextValue {
  const owner = workspaceValue('owner')
  return {
    ...owner,
    currentWorkspace: { ...owner.currentWorkspace!, role: 'member' },
  }
}

function otherWorkspace(): WorkspaceContextValue {
  const owner = workspaceValue('owner')
  return {
    ...owner,
    currentWorkspace: {
      ...owner.currentWorkspace!,
      workspace_id: SECOND_WORKSPACE_ID,
      workspace_name: '另一个协同空间',
    },
  }
}

describe('项目列表', () => {
  it.each([390, 320])(
    '%dpx 窄屏保留单列卡片和核心创建入口',
    async (viewportWidth) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: viewportWidth,
      })
      window.dispatchEvent(new Event('resize'))

      renderWithContexts('/projects', <ProjectsPage />)

      const list = await screen.findByRole('region', { name: '项目列表' })
      expect(within(list).getAllByRole('article')).toHaveLength(1)
      expect(
        screen.getByRole('link', { name: '创建运维项目' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('table')).toBeNull()
    },
  )

  it('显示加载状态，并在空响应后显示安全空状态', async () => {
    let resolveList:
      ((value: { ok: true; data: Project[] }) => void) | undefined
    const list = vi.fn(
      () =>
        new Promise<{ ok: true; data: Project[] }>((resolve) => {
          resolveList = resolve
        }),
    )
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目')
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await act(async () => {
      resolveList?.({ ok: true, data: [] })
    })
    expect(
      await screen.findByRole('heading', { name: '暂无项目' }),
    ).toBeInTheDocument()
  })

  it('错误状态可重试，并且不会显示原始服务细节', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: 'unknown_service_error' as const,
          message: '安全错误提示',
        },
      })
      .mockResolvedValueOnce({ ok: true as const, data: [currentProject] })
    const user = userEvent.setup()
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    expect(await screen.findByText('安全错误提示')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('默认不展示归档项目，显式切换后只请求并展示归档项目', async () => {
    const list = vi.fn(
      async (input: Parameters<ProjectContextValue['list']>[0]) => ({
        ok: true as const,
        data: input.archivedOnly ? [archivedProject] : [currentProject],
      }),
    )
    const user = userEvent.setup()
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()
    expect(screen.queryByText(archivedProject.name)).toBeNull()
    await user.click(screen.getByRole('button', { name: '已归档' }))
    expect(await screen.findByText(archivedProject.name)).toBeInTheDocument()
    expect(screen.queryByText(currentProject.name)).toBeNull()
    expect(list).toHaveBeenLastCalledWith({
      workspaceId: FICTIONAL_WORKSPACE_ID,
      archivedOnly: true,
    })
  })

  it('名称描述搜索和状态筛选共同工作', async () => {
    const pausedProject: Project = {
      ...currentProject,
      project_id: SECOND_PROJECT_ID,
      name: '虚构巡检乙项目',
      description: '包含专项关键词',
      status: 'paused',
    }
    const user = userEvent.setup()
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({
        list: vi.fn(async () => ({
          ok: true as const,
          data: [currentProject, pausedProject],
        })),
      }),
    )
    await screen.findByText(currentProject.name)

    await user.type(screen.getByLabelText('搜索项目'), '专项关键词')
    expect(screen.getByText(pausedProject.name)).toBeInTheDocument()
    expect(screen.queryByText(currentProject.name)).toBeNull()
    await user.clear(screen.getByLabelText('搜索项目'))
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'active')
    expect(screen.getByText(currentProject.name)).toBeInTheDocument()
    expect(screen.queryByText(pausedProject.name)).toBeNull()
  })

  it.each<WorkspaceRole>(['owner', 'admin'])(
    '%s 可看到创建入口',
    async (role) => {
      renderWithContexts('/projects', <ProjectsPage />, role)
      expect(
        await screen.findByRole('link', { name: '创建运维项目' }),
      ).toBeInTheDocument()
    },
  )

  it.each<WorkspaceRole>(['member', 'external_collaborator'])(
    '%s 不显示创建入口',
    async (role) => {
      renderWithContexts('/projects', <ProjectsPage />, role)
      await screen.findByText(currentProject.name)
      expect(screen.queryByRole('link', { name: '创建运维项目' })).toBeNull()
    },
  )
})

describe('项目列表加载竞态', () => {
  it('切换归档视图后，旧当前视图请求晚返回也不能覆盖归档结果', async () => {
    const deferredCurrent = createDeferred<ListResult>()
    const deferredArchived = createDeferred<ListResult>()
    const resolvers: Record<'false' | 'true', Deferred<ListResult>> = {
      false: deferredCurrent,
      true: deferredArchived,
    }
    const list = vi.fn(
      async (input: Parameters<ProjectContextValue['list']>[0]) =>
        resolvers[String(input.archivedOnly) as 'false' | 'true'].promise,
    )
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '已归档' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    await act(async () => {
      deferredArchived.resolve({ ok: true, data: [archivedProject] })
    })
    expect(await screen.findByText(archivedProject.name)).toBeInTheDocument()

    await act(async () => {
      deferredCurrent.resolve({ ok: true, data: [currentProject] })
    })
    await waitFor(() =>
      expect(screen.queryByText(currentProject.name)).toBeNull(),
    )
    expect(screen.getByText(archivedProject.name)).toBeInTheDocument()
  })

  it('归档请求成功后，旧当前视图请求失败也不能把页面覆盖成错误', async () => {
    const deferredCurrent = createDeferred<ListResult>()
    const deferredArchived = createDeferred<ListResult>()
    const resolvers: Record<'false' | 'true', Deferred<ListResult>> = {
      false: deferredCurrent,
      true: deferredArchived,
    }
    const list = vi.fn(
      async (input: Parameters<ProjectContextValue['list']>[0]) =>
        resolvers[String(input.archivedOnly) as 'false' | 'true'].promise,
    )
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '已归档' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    await act(async () => {
      deferredArchived.resolve({ ok: true, data: [archivedProject] })
    })
    expect(await screen.findByText(archivedProject.name)).toBeInTheDocument()

    await act(async () => {
      deferredCurrent.resolve({
        ok: false,
        error: { code: 'unknown_service_error', message: '旧请求失败' },
      })
    })
    await waitFor(() => expect(screen.queryByText('旧请求失败')).toBeNull())
    expect(screen.getByText(archivedProject.name)).toBeInTheDocument()
  })

  it('归档请求失败后，旧当前视图请求成功也不能把页面覆盖成旧数据', async () => {
    const deferredCurrent = createDeferred<ListResult>()
    const deferredArchived = createDeferred<ListResult>()
    const resolvers: Record<'false' | 'true', Deferred<ListResult>> = {
      false: deferredCurrent,
      true: deferredArchived,
    }
    const list = vi.fn(
      async (input: Parameters<ProjectContextValue['list']>[0]) =>
        resolvers[String(input.archivedOnly) as 'false' | 'true'].promise,
    )
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '已归档' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    await act(async () => {
      deferredArchived.resolve({
        ok: false,
        error: { code: 'unknown_service_error', message: '归档请求失败' },
      })
    })
    expect(await screen.findByText('归档请求失败')).toBeInTheDocument()

    await act(async () => {
      deferredCurrent.resolve({ ok: true, data: [currentProject] })
    })
    await waitFor(() =>
      expect(screen.queryByText(currentProject.name)).toBeNull(),
    )
    expect(screen.getByText('归档请求失败')).toBeInTheDocument()
  })
})

describe('创建项目', () => {
  it('普通成员手工访问创建页时前端拒绝且不调用创建服务', () => {
    const create = vi.fn()
    renderWithContexts(
      '/projects/new',
      <NewProjectPage />,
      'member',
      projectValue({ create }),
    )
    expect(
      screen.getByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('校验必填名称和 date-only 范围', async () => {
    const user = userEvent.setup()
    renderWithContexts('/projects/new', <NewProjectPage />)
    await user.type(screen.getByLabelText('开始日期'), '2026-08-20')
    await user.type(screen.getByLabelText('截止日期'), '2026-08-04')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(screen.getByText('项目名称不能为空。')).toBeInTheDocument()
    expect(screen.getByText('截止日期不得早于开始日期。')).toBeInTheDocument()
  })

  it('创建成功后导航到详情，并只提交稳定幂等键和允许字段', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => ({
      ok: true as const,
      data: currentProject,
    }))
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'bbbbbbbb-1111-4111-8111-111111111111',
    )
    renderWithContexts(
      '/projects/new',
      <Routes>
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<p>已进入项目详情</p>} />
      </Routes>,
      'owner',
      projectValue({ create }),
    )
    await user.type(screen.getByLabelText(/项目名称/), '虚构新项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByText('已进入项目详情')).toBeInTheDocument()
    expect(create).toHaveBeenCalledWith({
      workspaceId: FICTIONAL_WORKSPACE_ID,
      name: '虚构新项目',
      description: '',
      projectType: 'operations',
      initialStatus: 'planning',
      startDate: null,
      dueDate: null,
      idempotencyKey: 'bbbbbbbb-1111-4111-8111-111111111111',
    })
  })

  it('失败后保留输入且未修改表单的重试复用同一幂等键', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async (input: ProjectCreateInput) => {
      void input
      return {
        ok: false as const,
        error: {
          code: 'unknown_service_error' as const,
          message: '安全失败提示',
        },
      }
    })
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'bbbbbbbb-2222-4222-8222-222222222222',
    )
    renderWithContexts(
      '/projects/new',
      <NewProjectPage />,
      'owner',
      projectValue({ create }),
    )
    const nameInput = screen.getByLabelText(/项目名称/)
    await user.type(nameInput, '保留的虚构项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('安全失败提示')
    expect(nameInput).toHaveValue('保留的虚构项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1][0].idempotencyKey).toBe(
      create.mock.calls[0][0].idempotencyKey,
    )
  })

  it('提交未完成时禁用重复点击', async () => {
    const user = userEvent.setup()
    let resolveCreate:
      ((value: { ok: true; data: Project }) => void) | undefined
    const create = vi.fn(
      () =>
        new Promise<{ ok: true; data: Project }>((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderWithContexts(
      '/projects/new',
      <NewProjectPage />,
      'owner',
      projectValue({ create }),
    )
    await user.type(screen.getByLabelText(/项目名称/), '防重复虚构项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    const pendingButton = screen.getByRole('button', { name: /^正在创建/ })
    expect(pendingButton).toBeDisabled()
    await user.click(pendingButton)
    expect(create).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate?.({ ok: true, data: currentProject })
    })
  })
})

describe('项目详情、编辑与归档', () => {
  it('详情显示负责人、空牵头人、日期和后续能力边界', async () => {
    renderWithContexts(
      `/projects/${PROJECT_ID}`,
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
    )
    expect(
      await screen.findByRole('heading', { name: currentProject.name }),
    ).toBeInTheDocument()
    expect(screen.getByText('虚构负责人甲')).toBeInTheDocument()
    expect(screen.getByText('暂未设置')).toBeInTheDocument()
    expect(screen.getByText('2026年8月4日')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '项目成员' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '项目模块' }),
    ).toBeInTheDocument()
  })

  it('不存在和无权访问使用同一安全状态', async () => {
    renderWithContexts(
      `/projects/${PROJECT_ID}`,
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      'member',
      projectValue({
        get: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: 'not_found_or_forbidden' as const,
            message: '项目不存在或你无权访问。',
          },
        })),
      }),
    )
    expect(
      await screen.findByRole('heading', { name: '无法打开项目' }),
    ).toBeInTheDocument()
    expect(screen.getByText('项目不存在或你无权访问。')).toBeInTheDocument()
  })

  it('已完成项目通过确认对话框归档，成功后留在归档详情', async () => {
    const user = userEvent.setup()
    const archive = vi.fn(async () => ({
      ok: true as const,
      data: archivedProject,
    }))
    renderWithContexts(
      `/projects/${SECOND_PROJECT_ID}`,
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      'owner',
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: completedProject })),
        archive,
      }),
    )
    await user.click(await screen.findByRole('button', { name: '归档项目' }))
    const dialog = screen.getByRole('dialog', { name: '归档项目' })
    expect(dialog).toHaveTextContent('不会被物理删除')
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))
    expect(await screen.findByRole('status')).toHaveTextContent('项目已归档')
    expect(screen.getByText('已归档')).toBeInTheDocument()
    expect(archive).toHaveBeenCalledWith(
      completedProject.project_id,
      completedProject.updated_at,
    )
  })

  it('归档失败保留对话框并显示安全可重试提示', async () => {
    const user = userEvent.setup()
    renderWithContexts(
      `/projects/${SECOND_PROJECT_ID}`,
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      'owner',
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: completedProject })),
        archive: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: 'concurrent_update' as const,
            message: '请刷新后重试。',
          },
        })),
      }),
    )
    await user.click(await screen.findByRole('button', { name: '归档项目' }))
    await user.click(screen.getByRole('button', { name: '确认归档' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请刷新后重试。')
    expect(screen.getByRole('dialog', { name: '归档项目' })).toBeInTheDocument()
  })

  it('普通成员手工访问编辑页时前端拒绝且不读取编辑数据', () => {
    const get = vi.fn()
    renderWithContexts(
      `/projects/${PROJECT_ID}/edit`,
      <Routes>
        <Route path="/projects/:projectId/edit" element={<EditProjectPage />} />
      </Routes>,
      'member',
      projectValue({ get }),
    )
    expect(
      screen.getByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })

  it('编辑页只提供合法状态流转，并映射乐观并发冲突', async () => {
    const user = userEvent.setup()
    const update = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'concurrent_update' as const,
        message: '项目已被其他人修改，请刷新后重试。',
      },
    }))
    renderWithContexts(
      `/projects/${PROJECT_ID}/edit`,
      <Routes>
        <Route path="/projects/:projectId/edit" element={<EditProjectPage />} />
      </Routes>,
      'admin',
      projectValue({ update }),
    )
    const statusSelect = await screen.findByLabelText(/项目状态/)
    expect(
      within(statusSelect).getByRole('option', { name: '进行中' }),
    ).toBeInTheDocument()
    expect(
      within(statusSelect).getByRole('option', { name: '暂停' }),
    ).toBeInTheDocument()
    expect(
      within(statusSelect).getByRole('option', { name: '已完成' }),
    ).toBeInTheDocument()
    expect(
      within(statusSelect).queryByRole('option', { name: '筹备中' }),
    ).toBeNull()
    expect(
      within(statusSelect).queryByRole('option', { name: '已归档' }),
    ).toBeNull()
    await user.selectOptions(statusSelect, 'paused')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('刷新后重试')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        status: 'paused',
        expectedUpdatedAt: currentProject.updated_at,
      }),
    )
  })

  it('归档项目不可进入普通编辑流程', async () => {
    renderWithContexts(
      `/projects/${SECOND_PROJECT_ID}/edit`,
      <Routes>
        <Route path="/projects/:projectId/edit" element={<EditProjectPage />} />
      </Routes>,
      'owner',
      projectValue({
        get: vi.fn(async () => ({ ok: true as const, data: archivedProject })),
      }),
    )
    expect(
      await screen.findByRole('heading', { name: '项目已归档' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull()
  })

  it('详情页旧工作空间请求晚返回时不能覆盖当前工作空间项目', async () => {
    type DetailResult =
      | { ok: true; data: Project }
      | { ok: false; error: { code: 'unknown_service_error'; message: string } }
    const deferredOld = createDeferred<DetailResult>()
    const deferredNew = createDeferred<DetailResult>()
    let callCount = 0
    const get = vi.fn(async () => {
      callCount += 1
      return callCount === 1 ? deferredOld.promise : deferredNew.promise
    })

    const SECOND_WORKSPACE_ID = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    const oldWorkspace = workspaceValue('owner')
    const newWorkspace: WorkspaceContextValue = {
      ...oldWorkspace,
      currentWorkspace: {
        ...oldWorkspace.currentWorkspace!,
        workspace_id: SECOND_WORKSPACE_ID,
        workspace_name: '另一个协同空间',
      },
    }
    const workspaceRef = { current: oldWorkspace }

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={workspaceRef.current}>
          <ProjectContext.Provider value={projectValue({ get })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    workspaceRef.current = newWorkspace
    rerender(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))

    const staleProject: Project = {
      ...currentProject,
      name: '旧工作空间项目',
    }
    const latestProject: Project = {
      ...currentProject,
      workspace_id: SECOND_WORKSPACE_ID,
      name: '当前工作空间项目',
    }

    await act(async () => {
      deferredOld.resolve({ ok: true, data: staleProject })
    })
    expect(screen.queryByText(staleProject.name)).toBeNull()

    await act(async () => {
      deferredNew.resolve({ ok: true, data: latestProject })
    })
    expect(await screen.findByText(latestProject.name)).toBeInTheDocument()
    expect(screen.queryByText(staleProject.name)).toBeNull()
  })
})

describe('项目加载作用域窗口（第二请求尚未发出）', () => {
  it('列表页切换到归档视图后，在归档请求完成前解析旧当前请求，旧项目不得显示在归档标题下', async () => {
    const deferredCurrent = createDeferred<ListResult>()
    const deferredArchived = createDeferred<ListResult>()
    const resolvers: Record<'false' | 'true', Deferred<ListResult>> = {
      false: deferredCurrent,
      true: deferredArchived,
    }
    const list = vi.fn(
      async (input: Parameters<ProjectContextValue['list']>[0]) =>
        resolvers[String(input.archivedOnly) as 'false' | 'true'].promise,
    )
    renderWithContexts(
      '/projects',
      <ProjectsPage />,
      'owner',
      projectValue({ list }),
    )

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '已归档' }))
    // Resolve the old current-view request WITHOUT waiting for the archived
    // request to be issued or resolved. This is the defect window: without
    // scope binding the stale project could render under the archived heading.
    await act(async () => {
      deferredCurrent.resolve({ ok: true, data: [currentProject] })
    })
    // The stale current project must not appear under the archived heading.
    expect(screen.queryByText(currentProject.name)).toBeNull()
    // And we must be sitting in a safe loading state, not showing old data.
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目')
    // Now let the archived request resolve.
    await act(async () => {
      deferredArchived.resolve({ ok: true, data: [archivedProject] })
    })
    expect(await screen.findByText(archivedProject.name)).toBeInTheDocument()
    expect(screen.queryByText(currentProject.name)).toBeNull()
  })

  it('详情页已加载项目 A 后切换到项目 B，B 完成前 A 不再显示', async () => {
    type DetailResult =
      | { ok: true; data: Project }
      | { ok: false; error: { code: 'unknown_service_error'; message: string } }
    const deferredA = createDeferred<DetailResult>()
    const deferredB = createDeferred<DetailResult>()
    let callCount = 0
    const get = vi.fn(async () => {
      callCount += 1
      return callCount === 1 ? deferredA.promise : deferredB.promise
    })

    let capturedNavigate: ((to: string) => void) | undefined
    const NavBridge = ({ children }: { children: React.ReactNode }) => {
      capturedNavigate = useNavigate()
      return <>{children}</>
    }

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={workspaceValue('owner')}>
          <ProjectContext.Provider value={projectValue({ get })}>
            <NavBridge>
              <Routes>
                <Route
                  path="/projects/:projectId"
                  element={<ProjectDetailPage />}
                />
              </Routes>
            </NavBridge>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredA.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()

    await act(async () => {
      capturedNavigate?.(`/projects/${SECOND_PROJECT_ID}`)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    // Before B resolves, A must no longer be shown and we sit in loading.
    expect(screen.queryByText(currentProject.name)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目详情')

    await act(async () => {
      deferredB.resolve({
        ok: true,
        data: {
          ...currentProject,
          project_id: SECOND_PROJECT_ID,
          name: '虚构乙项目',
        },
      })
    })
    expect(await screen.findByText('虚构乙项目')).toBeInTheDocument()
    expect(screen.queryByText(currentProject.name)).toBeNull()
  })

  it('详情页路由切换到 B 后，晚返回的旧请求 A 不能覆盖 B', async () => {
    type DetailResult =
      | { ok: true; data: Project }
      | { ok: false; error: { code: 'unknown_service_error'; message: string } }
    const deferredA = createDeferred<DetailResult>()
    const deferredB = createDeferred<DetailResult>()
    let callCount = 0
    const get = vi.fn(async () => {
      callCount += 1
      return callCount === 1 ? deferredA.promise : deferredB.promise
    })

    let capturedNavigate: ((to: string) => void) | undefined
    const NavBridge = ({ children }: { children: React.ReactNode }) => {
      capturedNavigate = useNavigate()
      return <>{children}</>
    }

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={workspaceValue('owner')}>
          <ProjectContext.Provider value={projectValue({ get })}>
            <NavBridge>
              <Routes>
                <Route
                  path="/projects/:projectId"
                  element={<ProjectDetailPage />}
                />
              </Routes>
            </NavBridge>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      capturedNavigate?.(`/projects/${SECOND_PROJECT_ID}`)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    // Neither request resolved yet: A must not appear.
    expect(screen.queryByText(currentProject.name)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目详情')

    await act(async () => {
      deferredB.resolve({
        ok: true,
        data: {
          ...currentProject,
          project_id: SECOND_PROJECT_ID,
          name: '虚构乙项目',
        },
      })
    })
    expect(await screen.findByText('虚构乙项目')).toBeInTheDocument()
    expect(screen.queryByText(currentProject.name)).toBeNull()

    // Late A returns after B is already shown; it must not override B.
    await act(async () => {
      deferredA.resolve({ ok: true, data: currentProject })
    })
    await waitFor(() =>
      expect(screen.queryByText(currentProject.name)).toBeNull(),
    )
    expect(screen.getByText('虚构乙项目')).toBeInTheDocument()
  })

  it('编辑页项目 ID 变化后旧表单不能继续显示', async () => {
    type DetailResult =
      | { ok: true; data: Project }
      | { ok: false; error: { code: 'unknown_service_error'; message: string } }
    const deferredA = createDeferred<DetailResult>()
    const deferredB = createDeferred<DetailResult>()
    let callCount = 0
    const get = vi.fn(async () => {
      callCount += 1
      return callCount === 1 ? deferredA.promise : deferredB.promise
    })

    let capturedNavigate: ((to: string) => void) | undefined
    const NavBridge = ({ children }: { children: React.ReactNode }) => {
      capturedNavigate = useNavigate()
      return <>{children}</>
    }

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={workspaceValue('owner')}>
          <ProjectContext.Provider value={projectValue({ get })}>
            <NavBridge>
              <Routes>
                <Route
                  path="/projects/:projectId/edit"
                  element={<EditProjectPage />}
                />
              </Routes>
            </NavBridge>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredA.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    await act(async () => {
      capturedNavigate?.(`/projects/${SECOND_PROJECT_ID}/edit`)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    // Old form data must not persist under the new project id.
    expect(screen.queryByDisplayValue(currentProject.name)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目')

    await act(async () => {
      deferredB.resolve({
        ok: true,
        data: {
          ...currentProject,
          project_id: SECOND_PROJECT_ID,
          name: '虚构乙项目',
        },
      })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue('虚构乙项目')
  })

  it('编辑页管理权限降为 member 后显示无权限且不读取新详情', async () => {
    type DetailResult =
      | { ok: true; data: Project }
      | { ok: false; error: { code: 'unknown_service_error'; message: string } }
    const deferredA = createDeferred<DetailResult>()
    const get = vi.fn(async () => deferredA.promise)
    const ownerWs = workspaceValue('owner')
    const memberWs: WorkspaceContextValue = {
      ...ownerWs,
      currentWorkspace: {
        ...ownerWs.currentWorkspace!,
        role: 'member',
      },
    }
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <EditProjectPage />
      </Wrapper>,
    )

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredA.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    wsRef.current = memberWs
    rerender(
      <Wrapper>
        <EditProjectPage />
      </Wrapper>,
    )
    expect(
      await screen.findByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull()
    // No new detail read after the role drop.
    expect(get).toHaveBeenCalledTimes(1)
    expect(screen.queryByDisplayValue(currentProject.name)).toBeNull()
  })
})

describe('项目列表角色变化读取作用域', () => {
  it('owner 降为 member 后旧全量列表立即消失并重新读取', async () => {
    const deferredFirst = createDeferred<ListResult>()
    const deferredSecond = createDeferred<ListResult>()
    let call = 0
    const list = vi.fn(async () =>
      ++call === 1 ? deferredFirst.promise : deferredSecond.promise,
    )
    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/projects']}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ list })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectsPage />
      </Wrapper>,
    )
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredFirst.resolve({ ok: true, data: [currentProject] })
    })
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()

    // Demote the role. The old full list must disappear immediately (loading)
    // without waiting for the new request to start or finish.
    const memberWs = memberWorkspace()
    await act(async () => {
      wsRef.current = memberWs
      rerender(
        <Wrapper>
          <ProjectsPage />
        </Wrapper>,
      )
    })
    expect(screen.queryByText(currentProject.name)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目')

    // Re-read under the new role.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await act(async () => {
      deferredSecond.resolve({ ok: true, data: [currentProject] })
    })
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()
  })
})

describe('项目详情角色变化读取作用域', () => {
  it('角色下降后旧详情立即消失并重新验证', async () => {
    const deferredFirst = createDeferred<DetailServiceResult>()
    const deferredSecond = createDeferred<DetailServiceResult>()
    let call = 0
    const get = vi.fn(async () =>
      ++call === 1 ? deferredFirst.promise : deferredSecond.promise,
    )
    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredFirst.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()

    // Role drop: hide the old owner/admin detail immediately and re-verify.
    const memberWs = memberWorkspace()
    await act(async () => {
      wsRef.current = memberWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    expect(screen.queryByText(currentProject.name)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载项目详情')

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await act(async () => {
      deferredSecond.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByText(currentProject.name)).toBeInTheDocument()
  })
})

describe('项目详情归档写作用域竞态', () => {
  it('归档成功跨工作空间响应被丢弃，页面始终显示新工作空间项目', async () => {
    const deferredDetailOld = createDeferred<DetailServiceResult>()
    const deferredDetailNew = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () =>
      ++detailCalls === 1
        ? deferredDetailOld.promise
        : deferredDetailNew.promise,
    )
    const deferredArchive = createDeferred<MutationServiceResult>()
    const archive = vi.fn(() => deferredArchive.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${SECOND_PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, archive })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailOld.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档项目' }))
    const dialog = screen.getByRole('dialog', { name: '归档项目' })
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))
    expect(archive).toHaveBeenCalledTimes(1)

    // Switch to a different workspace while the archive is still pending.
    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    const projectB: Project = {
      ...currentProject,
      workspace_id: SECOND_WORKSPACE_ID,
      name: '当前工作空间项目',
    }
    await act(async () => {
      deferredDetailNew.resolve({ ok: true, data: projectB })
    })
    expect(await screen.findByText(projectB.name)).toBeInTheDocument()

    // Resolve the stale archive success for workspace A.
    await act(async () => {
      deferredArchive.resolve({
        ok: true,
        data: { ...archivedProject, project_id: SECOND_PROJECT_ID },
      })
    })
    // No navigation back to A, no stale feedback, no reopened dialog.
    expect(screen.getByText(projectB.name)).toBeInTheDocument()
    expect(screen.queryByText(completedProject.name)).toBeNull()
    expect(screen.queryByText(/项目已归档/)).toBeNull()
    expect(screen.queryByRole('dialog', { name: '归档项目' })).toBeNull()
  })

  it('归档失败跨 scope 响应被丢弃，旧错误不写入新项目', async () => {
    const deferredDetailOld = createDeferred<DetailServiceResult>()
    const deferredDetailNew = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () =>
      ++detailCalls === 1
        ? deferredDetailOld.promise
        : deferredDetailNew.promise,
    )
    const deferredArchive = createDeferred<MutationServiceResult>()
    const archive = vi.fn(() => deferredArchive.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${SECOND_PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, archive })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailOld.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档项目' }))
    const dialog = screen.getByRole('dialog', { name: '归档项目' })
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))
    expect(archive).toHaveBeenCalledTimes(1)

    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    const projectB: Project = {
      ...currentProject,
      workspace_id: SECOND_WORKSPACE_ID,
      name: '当前工作空间项目',
    }
    await act(async () => {
      deferredDetailNew.resolve({ ok: true, data: projectB })
    })
    expect(await screen.findByText(projectB.name)).toBeInTheDocument()

    // Resolve the stale archive failure for workspace A.
    await act(async () => {
      deferredArchive.resolve({
        ok: false,
        error: {
          code: 'concurrent_update',
          message: '请刷新后重试。',
        },
      })
    })
    // The old error must not surface on the new project.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(projectB.name)).toBeInTheDocument()
  })

  it('归档在途时权限下降，旧响应不提交副作用且入口立即消失', async () => {
    const deferredArchive = createDeferred<MutationServiceResult>()
    const archive = vi.fn(() => deferredArchive.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${SECOND_PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider
            value={projectValue({
              get: vi.fn(async () => ({
                ok: true as const,
                data: completedProject,
              })),
              archive,
            })}
          >
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    expect(
      await screen.findByRole('button', { name: '归档项目' }),
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档项目' }))
    await user.click(screen.getByRole('button', { name: '确认归档' }))
    expect(archive).toHaveBeenCalledTimes(1)

    // Demote owner/admin -> member while archiving.
    const memberWs = memberWorkspace()
    await act(async () => {
      wsRef.current = memberWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    // The archive entry and the old dialog disappear immediately.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '归档项目' })).toBeNull(),
    )
    expect(screen.queryByRole('dialog', { name: '归档项目' })).toBeNull()

    // Stale success response must not commit any UI side effect.
    await act(async () => {
      deferredArchive.resolve({
        ok: true,
        data: archivedProject,
      })
    })
    expect(screen.queryByText(/项目已归档/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('编辑页保存写作用域竞态', () => {
  it('保存成功后切换项目，旧成功响应不导航且不影响新表单', async () => {
    const deferredUpdateA = createDeferred<MutationServiceResult>()
    const deferredDetailB = createDeferred<DetailServiceResult>()
    let getCalls = 0
    const get = vi.fn(async () => {
      getCalls += 1
      return getCalls === 1
        ? { ok: true as const, data: currentProject }
        : deferredDetailB.promise
    })
    const update = vi.fn(() => deferredUpdateA.promise)

    let capturedNavigate: ((to: string) => void) | undefined
    const NavBridge = ({ children }: { children: React.ReactNode }) => {
      capturedNavigate = useNavigate()
      return <>{children}</>
    }

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={workspaceValue('owner')}>
          <ProjectContext.Provider value={projectValue({ get, update })}>
            <NavBridge>
              <Routes>
                <Route
                  path="/projects/:projectId/edit"
                  element={<EditProjectPage />}
                />
                <Route
                  path="/projects/:projectId"
                  element={<p>已进入项目详情</p>}
                />
              </Routes>
            </NavBridge>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(update).toHaveBeenCalledTimes(1)

    // Switch to project B while A's save is still in flight.
    await act(async () => {
      capturedNavigate?.(`/projects/${SECOND_PROJECT_ID}/edit`)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    const projectB: Project = {
      ...currentProject,
      project_id: SECOND_PROJECT_ID,
      name: '虚构乙项目',
    }
    await act(async () => {
      deferredDetailB.resolve({ ok: true, data: projectB })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue('虚构乙项目')

    // Stale success for A must not navigate back to A.
    await act(async () => {
      deferredUpdateA.resolve({ ok: true, data: currentProject })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('虚构乙项目')
  })

  it('保存失败后权限下降，旧失败不显示错误且不恢复表单', async () => {
    const deferredUpdate = createDeferred<MutationServiceResult>()
    const update = vi.fn(() => deferredUpdate.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider
            value={projectValue({
              get: vi.fn(async () => ({
                ok: true as const,
                data: currentProject,
              })),
              update,
            })}
          >
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <EditProjectPage />
      </Wrapper>,
    )
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(update).toHaveBeenCalledTimes(1)

    // Demote owner/admin -> member while the save is pending.
    const memberWs = memberWorkspace()
    await act(async () => {
      wsRef.current = memberWs
      rerender(
        <Wrapper>
          <EditProjectPage />
        </Wrapper>,
      )
    })
    expect(
      await screen.findByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()

    // Stale failure must not show an error or restore the form.
    await act(async () => {
      deferredUpdate.resolve({
        ok: false,
        error: {
          code: 'unknown_service_error',
          message: '旧保存失败',
        },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()
  })

  it('保存成功后组件卸载，旧成功响应不导航', async () => {
    const deferredUpdate = createDeferred<MutationServiceResult>()
    const update = vi.fn(() => deferredUpdate.promise)

    function Harness({ show }: { show: boolean }) {
      return (
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
          <WorkspaceContext.Provider value={workspaceValue('owner')}>
            <ProjectContext.Provider
              value={projectValue({
                get: vi.fn(async () => ({
                  ok: true as const,
                  data: currentProject,
                })),
                update,
              })}
            >
              <Routes>
                <Route
                  path="/projects/:projectId/edit"
                  element={show ? <EditProjectPage /> : <p>页面已卸载</p>}
                />
                <Route
                  path="/projects/:projectId"
                  element={<p>已进入项目详情</p>}
                />
              </Routes>
            </ProjectContext.Provider>
          </WorkspaceContext.Provider>
        </MemoryRouter>
      )
    }

    const { rerender } = render(<Harness show />)
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(update).toHaveBeenCalledTimes(1)

    // Unmount the edit page before the request resolves.
    await act(async () => {
      rerender(<Harness show={false} />)
    })
    expect(screen.getByText('页面已卸载')).toBeInTheDocument()

    // Resolve the stale success: must not navigate to the old project.
    await act(async () => {
      deferredUpdate.resolve({ ok: true, data: currentProject })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
  })
})

describe('创建页创建写作用域竞态', () => {
  it('创建成功跨工作空间响应被丢弃，不导航且新工作空间表单安全', async () => {
    const deferredCreate = createDeferred<MutationServiceResult>()
    const create = vi.fn(() => deferredCreate.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/projects/new']}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ create })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <Routes>
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:projectId" element={<p>已进入项目详情</p>} />
        </Routes>
      </Wrapper>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/项目名称/), '工作空间A项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(create).toHaveBeenCalledTimes(1)

    // Switch to a different workspace before the create resolves.
    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <Routes>
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route
              path="/projects/:projectId"
              element={<p>已进入项目详情</p>}
            />
          </Routes>
        </Wrapper>,
      )
    })
    // The new workspace create page is fresh and not submitting.
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByRole('button', { name: '创建项目' })).toBeInTheDocument()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')

    // Resolve the stale success for workspace A.
    await act(async () => {
      deferredCreate.resolve({
        ok: true,
        data: { ...currentProject, workspace_id: FICTIONAL_WORKSPACE_ID },
      })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')
  })

  it('创建失败跨工作空间响应被丢弃，旧错误不写入新工作空间', async () => {
    const deferredCreate = createDeferred<MutationServiceResult>()
    const create = vi.fn(() => deferredCreate.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/projects/new']}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ create })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <Routes>
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:projectId" element={<p>已进入项目详情</p>} />
        </Routes>
      </Wrapper>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/项目名称/), '工作空间A项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(create).toHaveBeenCalledTimes(1)

    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <Routes>
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route
              path="/projects/:projectId"
              element={<p>已进入项目详情</p>}
            />
          </Routes>
        </Wrapper>,
      )
    })
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')

    // Resolve the stale failure for workspace A.
    await act(async () => {
      deferredCreate.resolve({
        ok: false,
        error: {
          code: 'unknown_service_error',
          message: '旧创建失败',
        },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')
  })
})

describe('项目详情归档作用域 ABA 失效', () => {
  it('归档成功在 A→B→A 后仍被丢弃，不写回旧归档且不显示反馈', async () => {
    const deferredDetailOld = createDeferred<DetailServiceResult>()
    const deferredDetailNew = createDeferred<DetailServiceResult>()
    const deferredDetailBack = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () => {
      detailCalls += 1
      if (detailCalls === 1) return deferredDetailOld.promise
      if (detailCalls === 2) return deferredDetailNew.promise
      return deferredDetailBack.promise
    })
    const deferredArchive = createDeferred<MutationServiceResult>()
    const archive = vi.fn(() => deferredArchive.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${SECOND_PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, archive })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailOld.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档项目' }))
    const dialog = screen.getByRole('dialog', { name: '归档项目' })
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))
    expect(archive).toHaveBeenCalledTimes(1)

    // A -> B: dialog/loading already reset by the scope transition.
    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    const projectB: Project = {
      ...currentProject,
      workspace_id: SECOND_WORKSPACE_ID,
      name: '当前工作空间项目',
    }
    await act(async () => {
      deferredDetailNew.resolve({ ok: true, data: projectB })
    })
    expect(await screen.findByText(projectB.name)).toBeInTheDocument()

    // B -> A: reload the original project under workspace A.
    await act(async () => {
      wsRef.current = ownerWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    await act(async () => {
      deferredDetailBack.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    // The stale archive success for the original A scope returns. Its entity
    // still matches A, so only the action-epoch guard (bumped on both
    // transitions) discards it.
    await act(async () => {
      deferredArchive.resolve({
        ok: true,
        data: { ...archivedProject, project_id: SECOND_PROJECT_ID },
      })
    })
    // No navigation, no stale feedback, no reopened dialog, A unchanged.
    expect(screen.getByText(completedProject.name)).toBeInTheDocument()
    expect(screen.queryByText(/项目已归档/)).toBeNull()
    expect(screen.queryByRole('dialog', { name: '归档项目' })).toBeNull()
    expect(screen.getByRole('button', { name: '归档项目' })).toBeInTheDocument()
  })

  it('归档失败在 A→B→A 后仍被丢弃，不显示旧错误', async () => {
    const deferredDetailOld = createDeferred<DetailServiceResult>()
    const deferredDetailNew = createDeferred<DetailServiceResult>()
    const deferredDetailBack = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () => {
      detailCalls += 1
      if (detailCalls === 1) return deferredDetailOld.promise
      if (detailCalls === 2) return deferredDetailNew.promise
      return deferredDetailBack.promise
    })
    const deferredArchive = createDeferred<MutationServiceResult>()
    const archive = vi.fn(() => deferredArchive.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[`/projects/${SECOND_PROJECT_ID}`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, archive })}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(
      <Wrapper>
        <ProjectDetailPage />
      </Wrapper>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailOld.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档项目' }))
    await user.click(screen.getByRole('button', { name: '确认归档' }))
    expect(archive).toHaveBeenCalledTimes(1)

    const newWs = otherWorkspace()
    await act(async () => {
      wsRef.current = newWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await act(async () => {
      deferredDetailNew.resolve({ ok: true, data: { ...currentProject } })
    })
    await act(async () => {
      wsRef.current = ownerWs
      rerender(
        <Wrapper>
          <ProjectDetailPage />
        </Wrapper>,
      )
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    await act(async () => {
      deferredDetailBack.resolve({ ok: true, data: completedProject })
    })
    expect(await screen.findByText(completedProject.name)).toBeInTheDocument()

    // Stale archive failure for workspace A returns; epoch guard discards it.
    await act(async () => {
      deferredArchive.resolve({
        ok: false,
        error: { code: 'concurrent_update', message: '旧归档失败' },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(completedProject.name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档项目' })).toBeInTheDocument()
  })
})

describe('编辑页保存作用域 ABA 失效', () => {
  it('保存成功在 A→B→A 后仍被丢弃，不导航且不修改当前表单', async () => {
    const deferredDetailA = createDeferred<DetailServiceResult>()
    const deferredDetailB = createDeferred<DetailServiceResult>()
    const deferredDetailABack = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () => {
      detailCalls += 1
      if (detailCalls === 1) return deferredDetailA.promise
      if (detailCalls === 2) return deferredDetailB.promise
      return deferredDetailABack.promise
    })
    const deferredUpdate = createDeferred<MutationServiceResult>()
    const update = vi.fn(() => deferredUpdate.promise)

    const NavBridge = ({ children }: { children: React.ReactNode }) => {
      return <>{children}</>
    }

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = () => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, update })}>
            <NavBridge>
              <Routes>
                <Route
                  path="/projects/:projectId/edit"
                  element={<EditProjectPage />}
                />
                <Route
                  path="/projects/:projectId"
                  element={<p>已进入项目详情</p>}
                />
              </Routes>
            </NavBridge>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(<Wrapper />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailA.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(update).toHaveBeenCalledTimes(1)

    // A -> B (workspace B, same project id). The loaded project belongs to A, so
    // the B scope shows the safe error state rather than the form.
    await act(async () => {
      wsRef.current = otherWorkspace()
      rerender(<Wrapper />)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await act(async () => {
      deferredDetailB.resolve({ ok: true, data: currentProject })
    })
    expect(
      await screen.findByRole('heading', { name: '无法编辑项目' }),
    ).toBeInTheDocument()

    // B -> A: reload the form under workspace A.
    await act(async () => {
      wsRef.current = ownerWs
      rerender(<Wrapper />)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    await act(async () => {
      deferredDetailABack.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    // Stale update success for A returns; epoch guard (two bumps) discards it.
    await act(async () => {
      deferredUpdate.resolve({ ok: true, data: currentProject })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue(currentProject.name)
  })

  it('保存失败在 A→B→A 后仍被丢弃，不显示旧错误', async () => {
    const deferredDetailA = createDeferred<DetailServiceResult>()
    const deferredDetailB = createDeferred<DetailServiceResult>()
    const deferredDetailABack = createDeferred<DetailServiceResult>()
    let detailCalls = 0
    const get = vi.fn(async () => {
      detailCalls += 1
      if (detailCalls === 1) return deferredDetailA.promise
      if (detailCalls === 2) return deferredDetailB.promise
      return deferredDetailABack.promise
    })
    const deferredUpdate = createDeferred<MutationServiceResult>()
    const update = vi.fn(() => deferredUpdate.promise)

    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const Wrapper = () => (
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/edit`]}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projectValue({ get, update })}>
            <Routes>
              <Route
                path="/projects/:projectId/edit"
                element={<EditProjectPage />}
              />
              <Route
                path="/projects/:projectId"
                element={<p>已进入项目详情</p>}
              />
            </Routes>
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )

    const { rerender } = render(<Wrapper />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      deferredDetailA.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      wsRef.current = otherWorkspace()
      rerender(<Wrapper />)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await act(async () => {
      deferredDetailB.resolve({ ok: true, data: currentProject })
    })
    await act(async () => {
      wsRef.current = ownerWs
      rerender(<Wrapper />)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    await act(async () => {
      deferredDetailABack.resolve({ ok: true, data: currentProject })
    })
    expect(await screen.findByLabelText(/项目名称/)).toHaveValue(
      currentProject.name,
    )

    // Stale update failure for A returns; epoch guard discards it.
    await act(async () => {
      deferredUpdate.resolve({
        ok: false,
        error: { code: 'unknown_service_error', message: '旧保存失败' },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue(currentProject.name)
  })
})

describe('创建页创建作用域 ABA 失效', () => {
  function CreateWrapper({
    wsRef,
    projects,
    children,
  }: {
    wsRef: { current: WorkspaceContextValue }
    projects?: ProjectContextValue
    children: React.ReactNode
  }) {
    return (
      <MemoryRouter initialEntries={['/projects/new']}>
        <WorkspaceContext.Provider value={wsRef.current}>
          <ProjectContext.Provider value={projects ?? projectValue()}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    )
  }

  function CreateRoutes() {
    return (
      <Routes>
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<p>已进入项目详情</p>} />
      </Routes>
    )
  }

  it('创建成功在 workspace A→B→A 后仍被丢弃，不导航', async () => {
    const deferredCreate = createDeferred<MutationServiceResult>()
    const create = vi.fn(() => deferredCreate.promise)

    const projects = projectValue({ create })
    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const { rerender } = render(
      <CreateWrapper wsRef={wsRef} projects={projects}>
        <CreateRoutes />
      </CreateWrapper>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/项目名称/), '工作空间A项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(create).toHaveBeenCalledTimes(1)

    await act(async () => {
      wsRef.current = otherWorkspace()
      rerender(
        <CreateWrapper wsRef={wsRef} projects={projects}>
          <CreateRoutes />
        </CreateWrapper>,
      )
    })
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')

    await act(async () => {
      wsRef.current = ownerWs
      rerender(
        <CreateWrapper wsRef={wsRef} projects={projects}>
          <CreateRoutes />
        </CreateWrapper>,
      )
    })
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')

    // Stale create success for A returns; epoch guard (two bumps) discards it.
    await act(async () => {
      deferredCreate.resolve({
        ok: true,
        data: { ...currentProject, workspace_id: FICTIONAL_WORKSPACE_ID },
      })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')
  })

  it('创建成功在 owner→member→owner 后仍被丢弃，不恢复旧 owner 创建', async () => {
    const deferredCreate = createDeferred<MutationServiceResult>()
    const create = vi.fn(() => deferredCreate.promise)

    const projects = projectValue({ create })
    const ownerWs = workspaceValue('owner')
    const wsRef = { current: ownerWs }
    const { rerender } = render(
      <CreateWrapper wsRef={wsRef} projects={projects}>
        <CreateRoutes />
      </CreateWrapper>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/项目名称/), 'owner项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(create).toHaveBeenCalledTimes(1)

    await act(async () => {
      wsRef.current = memberWorkspace()
      rerender(
        <CreateWrapper wsRef={wsRef} projects={projects}>
          <CreateRoutes />
        </CreateWrapper>,
      )
    })
    expect(
      await screen.findByRole('heading', { name: '暂无访问权限' }),
    ).toBeInTheDocument()

    await act(async () => {
      wsRef.current = ownerWs
      rerender(
        <CreateWrapper wsRef={wsRef} projects={projects}>
          <CreateRoutes />
        </CreateWrapper>,
      )
    })
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')

    // Stale owner create success returns; epoch guard (two bumps) discards it.
    await act(async () => {
      deferredCreate.resolve({
        ok: true,
        data: { ...currentProject, workspace_id: FICTIONAL_WORKSPACE_ID },
      })
    })
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('')
  })
})

describe('响应实体不匹配安全结束 loading', () => {
  it('归档成功返回错误 project_id/workspace_id 时安全失败且不写项目', async () => {
    const user = userEvent.setup()
    const archive = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...archivedProject,
        project_id: 'dddddddd-0000-4000-8000-0000000000dd',
        workspace_id: 'eeeeeeee-0000-4000-8000-0000000000ee',
      },
    }))
    renderWithContexts(
      `/projects/${SECOND_PROJECT_ID}`,
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      'owner',
      projectValue({
        get: vi.fn(async () => ({
          ok: true as const,
          data: completedProject,
        })),
        archive,
      }),
    )
    await user.click(await screen.findByRole('button', { name: '归档项目' }))
    const dialog = screen.getByRole('dialog', { name: '归档项目' })
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }))
    // Loading ends, unified safe error shows, dialog stays open, project not
    // written, no raw data leaked.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '项目操作暂时无法完成，请稍后重试。',
    )
    expect(screen.getByRole('button', { name: '确认归档' })).toBeEnabled()
    expect(screen.queryByText(/项目已归档/)).toBeNull()
    expect(screen.getByText(completedProject.name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档项目' })).toBeInTheDocument()
  })

  it('编辑保存成功返回错误 project_id/workspace_id 时安全失败且保留输入', async () => {
    const user = userEvent.setup()
    const update = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...currentProject,
        project_id: 'dddddddd-0000-4000-8000-0000000000dd',
        workspace_id: 'eeeeeeee-0000-4000-8000-0000000000ee',
      },
    }))
    renderWithContexts(
      `/projects/${PROJECT_ID}/edit`,
      <Routes>
        <Route path="/projects/:projectId/edit" element={<EditProjectPage />} />
      </Routes>,
      'admin',
      projectValue({
        get: vi.fn(async () => ({
          ok: true as const,
          data: currentProject,
        })),
        update,
      }),
    )
    const nameInput = await screen.findByLabelText(/项目名称/)
    await user.clear(nameInput)
    await user.type(nameInput, '修改后的名称')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    // Loading ends, unified safe error shows, no navigation, input preserved.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '项目操作暂时无法完成，请稍后重试。',
    )
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled()
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('修改后的名称')
  })

  it('创建成功返回错误 workspace_id 时安全失败且保留表单与幂等键', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async (input: ProjectCreateInput) => {
      void input
      return {
        ok: true as const,
        data: {
          ...currentProject,
          workspace_id: 'eeeeeeee-0000-4000-8000-0000000000ee',
        },
      }
    })
    const idem = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('bbbbbbbb-1111-4111-8111-111111111111')
    renderWithContexts(
      '/projects/new',
      <Routes>
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<p>已进入项目详情</p>} />
      </Routes>,
      'owner',
      projectValue({ create }),
    )
    const nameInput = screen.getByLabelText(/项目名称/)
    await user.type(nameInput, '待创建项目')
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    // Loading ends, unified safe error shows, no navigation, input preserved.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '项目操作暂时无法完成，请稍后重试。',
    )
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
    expect(screen.queryByText('已进入项目详情')).toBeNull()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('待创建项目')
    // The current scope's idempotency key is preserved across the retry.
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1][0].idempotencyKey).toBe(
      create.mock.calls[0][0].idempotencyKey,
    )
    idem.mockRestore()
  })
})
