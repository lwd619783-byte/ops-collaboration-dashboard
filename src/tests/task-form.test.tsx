import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskForm } from '@/features/tasks/TaskForm'
import type {
  TaskAssignmentCandidate,
  TaskFormValues,
} from '@/features/tasks/types'
import { validateTaskForm } from '@/features/tasks/validation'
import type { ProjectModule } from '@/features/projects'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const WORKSPACE_ID = '99999999-9999-4999-8999-999999999999'
const MODULE_ID = 'bbbbbbbb-1111-4111-8111-111111111111'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const VIEWER_ID = '33333333-3333-4333-8333-333333333333'

const modules: ProjectModule[] = [
  {
    module_id: MODULE_ID,
    project_id: PROJECT_ID,
    name: '虚构模块',
    sort_position: 0,
    created_by: OWNER_ID,
    updated_by: OWNER_ID,
    created_at: '2026-08-09T01:00:00+00:00',
    updated_at: '2026-08-09T01:00:00+00:00',
  },
]

const candidates: TaskAssignmentCandidate[] = [
  {
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    app_user_id: OWNER_ID,
    display_name: '虚构负责人',
    project_role: 'owner',
    can_hold_responsibility: true,
  },
  {
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    app_user_id: MEMBER_ID,
    display_name: '虚构协作人',
    project_role: 'member',
    can_hold_responsibility: true,
  },
  {
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    app_user_id: VIEWER_ID,
    display_name: '虚构只读成员',
    project_role: 'viewer',
    can_hold_responsibility: false,
  },
]

const emptyValues: TaskFormValues = {
  title: '',
  moduleId: '',
  assigneeId: '',
  collaboratorIds: [],
  reviewerId: '',
  priority: 'medium',
  startDate: '',
  dueDate: '',
  estimatedHours: '',
  workloadLevel: 'm',
  description: '',
  acceptanceCriteria: '',
  visibility: 'project',
  visibilityUserIds: [],
}

function renderForm(onSubmit = vi.fn()) {
  render(
    <TaskForm
      candidates={candidates}
      initialValues={emptyValues}
      isSubmitting={false}
      modules={modules}
      onSubmit={onSubmit}
      submitLabel="创建任务"
      submittingLabel="正在创建"
    />,
  )
  return onSubmit
}

describe('任务表单', () => {
  it('覆盖全部 Task 3.1 字段并在空提交时显示即时校验', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    expect(screen.getByLabelText(/任务标题/)).toBeInTheDocument()
    expect(screen.getByLabelText(/项目模块/)).toBeInTheDocument()
    expect(screen.getByLabelText(/主要负责人/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '协作人' })).toBeInTheDocument()
    expect(screen.getByLabelText(/验收人/)).toBeInTheDocument()
    expect(screen.getByLabelText(/优先级/)).toBeInTheDocument()
    expect(screen.getByLabelText(/开始日期/)).toBeInTheDocument()
    expect(screen.getByLabelText(/截止日期/)).toBeInTheDocument()
    expect(screen.getByLabelText(/预计工时/)).toBeInTheDocument()
    expect(screen.getByLabelText(/工作量等级/)).toBeInTheDocument()
    expect(screen.getByLabelText(/任务说明/)).toBeInTheDocument()
    expect(screen.getByLabelText(/验收标准/)).toBeInTheDocument()
    expect(screen.getByLabelText(/任务可见性/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(await screen.findByText('任务标题不能为空。')).toBeInTheDocument()
    expect(screen.getByText('请选择当前项目中的有效模块。')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('viewer 不进入职责下拉，但可在 restricted 显式授权中选择', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText(/任务标题/), '  虚构任务  ')
    await user.selectOptions(screen.getByLabelText(/项目模块/), MODULE_ID)
    await user.selectOptions(screen.getByLabelText(/主要负责人/), OWNER_ID)
    await user.selectOptions(screen.getByLabelText(/验收人/), MEMBER_ID)
    expect(
      screen.queryByRole('option', { name: '虚构只读成员' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/虚构协作人/))
    await user.selectOptions(screen.getByLabelText(/任务可见性/), 'restricted')
    const visibilityGroup = screen.getByRole('group', {
      name: '显式可见人员',
    })
    await user.click(
      withinGroup(visibilityGroup).getByLabelText(/虚构只读成员/),
    )
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '虚构任务',
        moduleId: MODULE_ID,
        assigneeId: OWNER_ID,
        collaboratorIds: [MEMBER_ID],
        reviewerId: MEMBER_ID,
        visibility: 'restricted',
        visibilityUserIds: [VIEWER_ID],
      }),
    )
  })

  it('非法日期、预计工时及重复关系由纯校验器拒绝', () => {
    const errors = validateTaskForm({
      ...emptyValues,
      title: '虚构任务',
      moduleId: MODULE_ID,
      assigneeId: OWNER_ID,
      collaboratorIds: [OWNER_ID, OWNER_ID],
      reviewerId: MEMBER_ID,
      startDate: '2026-08-10',
      dueDate: '2026-08-09',
      estimatedHours: '1.234',
      visibility: 'project',
      visibilityUserIds: [VIEWER_ID],
    })
    expect(errors.collaboratorIds).toBe('协作人不能重复。')
    expect(errors.dueDate).toBe('截止日期不得早于开始日期。')
    expect(errors.estimatedHours).toContain('最多两位小数')
    expect(errors.visibilityUserIds).toContain('不需要指定')
    expect(
      validateTaskForm({
        ...emptyValues,
        startDate: '2026-02-31',
      }).startDate,
    ).toBe('请输入有效开始日期。')
  })

  it('被篡改的枚举值由纯校验器拒绝', () => {
    const errors = validateTaskForm({
      ...emptyValues,
      priority: 'critical',
      workloadLevel: 'xxl',
      visibility: 'private',
    } as unknown as TaskFormValues)
    expect(errors.priority).toBe('请选择有效优先级。')
    expect(errors.workloadLevel).toBe('请选择有效工作量等级。')
    expect(errors.visibility).toBe('请选择有效任务可见性。')
  })

  it('360px 窄屏下仍渲染所有核心控件和提交入口', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    renderForm()
    expect(screen.getByRole('form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建任务' })).toBeVisible()
    expect(screen.getByLabelText(/任务标题/)).toBeEnabled()
  })
})

function withinGroup(group: HTMLElement) {
  return {
    getByLabelText: (name: RegExp) => {
      const labels = Array.from(group.querySelectorAll('label'))
      const label = labels.find((item) => name.test(item.textContent ?? ''))
      const input = label?.querySelector('input')
      if (!input) throw new Error('找不到分组内复选框')
      return input
    },
  }
}
