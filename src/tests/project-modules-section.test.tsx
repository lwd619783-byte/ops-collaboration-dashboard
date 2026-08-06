import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import { ProjectModulesSection } from '@/features/projects/ProjectModulesSection'
import type { Project, ProjectModule } from '@/features/projects/types'
import { FICTIONAL_WORKSPACE_ID } from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_PROJECT_ID = 'aaaaaaaa-2222-4222-8222-222222222222'
const ACTOR_ID = '11111111-1111-4111-8111-111111111111'

const project: Project = {
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '虚构模块项目',
  description: null,
  project_type: 'operations',
  status: 'active',
  owner_id: ACTOR_ID,
  owner_display_name: '虚构负责人',
  lead_id: null,
  lead_display_name: null,
  start_date: null,
  due_date: null,
  created_by: ACTOR_ID,
  created_at: '2026-08-06T01:00:00+00:00',
  updated_at: '2026-08-06T01:00:00+00:00',
  archived_at: null,
}

function module(
  moduleId: string,
  name: string,
  sortPosition: number,
  projectId = PROJECT_ID,
): ProjectModule {
  return {
    module_id: moduleId,
    project_id: projectId,
    name,
    sort_position: sortPosition,
    created_by: ACTOR_ID,
    updated_by: ACTOR_ID,
    created_at: project.created_at,
    updated_at: project.updated_at,
  }
}

const modules = [
  module('cccccccc-1111-4111-8111-111111111111', '核心模块甲', 0),
  module('cccccccc-2222-4222-8222-222222222222', '支撑模块乙', 1),
]

function projectValue(
  overrides: Partial<ProjectContextValue> = {},
): ProjectContextValue {
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [project] })),
    get: vi.fn(async () => ({ ok: true as const, data: project })),
    create: vi.fn(async () => ({ ok: true as const, data: project })),
    update: vi.fn(async () => ({ ok: true as const, data: project })),
    archive: vi.fn(async () => ({ ok: true as const, data: project })),
    listMembers: vi.fn(async () => ({ ok: true as const, data: [] })),
    listModules: vi.fn(async () => ({ ok: true as const, data: modules })),
    addModule: vi.fn(async () => ({ ok: true as const, data: modules })),
    renameModule: vi.fn(async () => ({ ok: true as const, data: modules })),
    reorderModules: vi.fn(async () => ({ ok: true as const, data: modules })),
    deleteModule: vi.fn(async () => ({ ok: true as const, data: modules })),
    listMemberCandidates: vi.fn(async () => ({ ok: true as const, data: [] })),
    addMember: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    setMemberRole: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    removeMember: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    setLead: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    clearLead: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    transferOwner: vi.fn(async () => ({
      ok: true as const,
      data: { ...project, changed: true },
    })),
    ...overrides,
  }
}

function renderSection(
  value: ProjectContextValue,
  canManage = true,
  currentProject = project,
) {
  return render(
    <ProjectContext.Provider value={value}>
      <ProjectModulesSection canManage={canManage} project={currentProject} />
    </ProjectContext.Provider>,
  )
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

describe('项目工作模块区域', () => {
  it('按数据库顺序显示数量和管理操作，首末移动边界明确', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    })
    renderSection(projectValue())

    expect(await screen.findByText('共 2 个模块')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('核心模块甲')).toBeInTheDocument()
    expect(within(rows[1]).getByText('支撑模块乙')).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole('button', { name: '上移模块：核心模块甲' }),
    ).toBeDisabled()
    expect(
      within(rows[1]).getByRole('button', { name: '下移模块：支撑模块乙' }),
    ).toBeDisabled()
    expect(
      within(rows[0]).getByRole('button', { name: '改名模块：核心模块甲' }),
    ).toBeVisible()
    expect(
      within(rows[0]).getByRole('button', { name: '删除模块：核心模块甲' }),
    ).toBeVisible()
  })

  it('空模块显示清晰空状态，只读用户没有管理按钮', async () => {
    renderSection(
      projectValue({
        listModules: vi.fn(async () => ({ ok: true as const, data: [] })),
      }),
      false,
    )
    expect(await screen.findByText('暂未创建工作模块。')).toBeInTheDocument()
    expect(screen.getByText(/你可以查看模块/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新增模块' })).toBeNull()
  })

  it('归档项目显示只读原因且隐藏全部修改入口', async () => {
    const archived = {
      ...project,
      status: 'archived' as const,
      archived_at: '2026-08-06T02:00:00+00:00',
    }
    renderSection(projectValue(), true, archived)
    expect(
      await screen.findByText(/项目已归档，模块保留为只读状态/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新增模块' })).toBeNull()
    expect(screen.queryByRole('button', { name: /改名模块/ })).toBeNull()
  })

  it('加载失败提供重试，重试成功后显示模块', async () => {
    const listModules = vi
      .fn<ProjectContextValue['listModules']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'network_unavailable', message: '网络暂时不可用。' },
      })
      .mockResolvedValueOnce({ ok: true, data: modules })
    const user = userEvent.setup()
    renderSection(projectValue({ listModules }))
    expect(screen.getByText('正在加载工作模块…')).toBeInTheDocument()
    expect(await screen.findByText('网络暂时不可用。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试加载模块' }))
    expect(await screen.findByText('共 2 个模块')).toBeInTheDocument()
    expect(listModules).toHaveBeenCalledTimes(2)
  })

  it('权限错误显示无权限状态且不提供盲目重试', async () => {
    renderSection(
      projectValue({
        listModules: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: 'module_not_found_or_forbidden' as const,
            message: '模块不存在或你无权访问。',
          },
        })),
      }),
    )
    expect(
      await screen.findByText('模块不存在或你无权访问。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试加载模块' })).toBeNull()
  })

  it('新增校验名称并在提交期间阻止重复请求', async () => {
    const pending = deferred<{
      ok: true
      data: ProjectModule[]
    }>()
    const added = [
      ...modules,
      module('cccccccc-3333-4333-8333-333333333333', '扩展 模块丙', 2),
    ]
    const addModule = vi.fn(() => pending.promise)
    const user = userEvent.setup()
    renderSection(projectValue({ addModule }))

    await user.click(await screen.findByRole('button', { name: '新增模块' }))
    const dialog = screen.getByRole('dialog', { name: '新增工作模块' })
    await user.click(within(dialog).getByRole('button', { name: '确认新增' }))
    expect(within(dialog).getByText('模块名称不能为空。')).toBeInTheDocument()
    await user.type(
      within(dialog).getByLabelText(/模块名称/),
      '  扩展   模块丙  ',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认新增' }))
    expect(addModule).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      name: '扩展 模块丙',
    })
    const pendingButton = within(dialog).getByRole('button', {
      name: /^正在保存/,
    })
    expect(pendingButton).toBeDisabled()
    await user.click(pendingButton)
    expect(addModule).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ ok: true, data: added }))
    expect(await screen.findByText('扩展 模块丙')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('模块已新增')
  })

  it('改名提交模块作用域并使用 RPC 返回的刷新列表', async () => {
    const renamed = [{ ...modules[0], name: '准备阶段' }, modules[1]]
    const renameModule = vi.fn(async () => ({
      ok: true as const,
      data: renamed,
    }))
    const user = userEvent.setup()
    renderSection(projectValue({ renameModule }))
    await user.click(
      await screen.findByRole('button', { name: '改名模块：核心模块甲' }),
    )
    const dialog = screen.getByRole('dialog', { name: '修改模块名称' })
    const input = within(dialog).getByLabelText(/模块名称/)
    await user.clear(input)
    await user.type(input, '准备阶段')
    await user.click(within(dialog).getByRole('button', { name: '确认改名' }))
    expect(renameModule).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      moduleId: modules[0].module_id,
      name: '准备阶段',
    })
    expect(await screen.findByText('准备阶段')).toBeInTheDocument()
  })

  it('上移下移提交完整有序 ID 列表', async () => {
    const reordered = [
      { ...modules[1], sort_position: 0 },
      { ...modules[0], sort_position: 1 },
    ]
    const reorderModules = vi.fn(async () => ({
      ok: true as const,
      data: reordered,
    }))
    const user = userEvent.setup()
    renderSection(projectValue({ reorderModules }))
    await user.click(
      await screen.findByRole('button', { name: '下移模块：核心模块甲' }),
    )
    expect(reorderModules).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      moduleIds: [modules[1].module_id, modules[0].module_id],
    })
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByText('支撑模块乙')).toBeInTheDocument()
  })

  it('删除前确认并在成功后显示剩余模块', async () => {
    const deleteModule = vi.fn(async () => ({
      ok: true as const,
      data: [{ ...modules[1], sort_position: 0 }],
    }))
    const user = userEvent.setup()
    renderSection(projectValue({ deleteModule }))
    await user.click(
      await screen.findByRole('button', { name: '删除模块：核心模块甲' }),
    )
    const dialog = screen.getByRole('dialog', { name: '删除工作模块' })
    expect(dialog).toHaveTextContent('待删除模块：核心模块甲')
    expect(dialog).toHaveTextContent('不能在当前版本中撤销')
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(deleteModule).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      moduleId: modules[0].module_id,
    })
    await waitFor(() => expect(screen.queryByText('核心模块甲')).toBeNull())
    expect(screen.getByText('支撑模块乙')).toBeInTheDocument()
  })

  it('安全业务错误不泄露数据库细节并允许再次操作', async () => {
    const addModule = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'module_name_conflict' as const,
        message: '当前项目中已存在同名模块。',
      },
    }))
    const user = userEvent.setup()
    renderSection(projectValue({ addModule }))
    await user.click(await screen.findByRole('button', { name: '新增模块' }))
    const dialog = screen.getByRole('dialog', { name: '新增工作模块' })
    await user.type(within(dialog).getByLabelText(/模块名称/), '核心模块甲')
    await user.click(within(dialog).getByRole('button', { name: '确认新增' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '当前项目中已存在同名模块。',
    )
    expect(screen.getByRole('button', { name: '确认新增' })).toBeEnabled()
    expect(screen.queryByText('public.project_modules')).toBeNull()
  })

  it('切换项目后旧加载结果不会覆盖新上下文', async () => {
    const oldRequest = deferred<{
      ok: true
      data: ProjectModule[]
    }>()
    const otherProject = {
      ...project,
      project_id: OTHER_PROJECT_ID,
      name: '另一个虚构项目',
    }
    const otherModules = [
      module(
        'dddddddd-1111-4111-8111-111111111111',
        '当前项目模块',
        0,
        OTHER_PROJECT_ID,
      ),
    ]
    const listModules = vi.fn((projectId: string) =>
      projectId === PROJECT_ID
        ? oldRequest.promise
        : Promise.resolve({ ok: true as const, data: otherModules }),
    )
    const value = projectValue({ listModules })
    const { rerender } = render(
      <ProjectContext.Provider value={value}>
        <ProjectModulesSection canManage key={PROJECT_ID} project={project} />
      </ProjectContext.Provider>,
    )
    await waitFor(() => expect(listModules).toHaveBeenCalledWith(PROJECT_ID))
    rerender(
      <ProjectContext.Provider value={value}>
        <ProjectModulesSection
          canManage
          key={OTHER_PROJECT_ID}
          project={otherProject}
        />
      </ProjectContext.Provider>,
    )
    expect(await screen.findByText('当前项目模块')).toBeInTheDocument()
    await act(async () => oldRequest.resolve({ ok: true, data: modules }))
    expect(screen.getByText('当前项目模块')).toBeInTheDocument()
    expect(screen.queryByText('核心模块甲')).toBeNull()
  })
})
