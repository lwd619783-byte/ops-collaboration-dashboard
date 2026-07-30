import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { taskStatuses, taskStatusMeta } from '@/lib/status/taskStatus'

describe('按钮', () => {
  it('普通按钮每次点击只触发一次操作', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<Button onClick={action}>保存</Button>)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('disabled 和 loading 按钮不触发操作且暴露忙碌状态', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(
      <>
        <Button disabled onClick={action}>
          禁用
        </Button>
        <Button loading onClick={action}>
          保存
        </Button>
      </>,
    )
    await user.click(screen.getByRole('button', { name: '禁用' }))
    await user.click(screen.getByRole('button', { name: /保存/ }))
    expect(action).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /保存/ })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })
})

describe('表单字段', () => {
  it('输入框同时关联说明和错误，正常字段不误报无效', () => {
    render(
      <>
        <InputField
          description="填写名称"
          error="名称不能为空"
          id="name"
          label="名称"
          required
        />
        <InputField id="owner" label="负责人" />
      </>,
    )
    const input = screen.getByRole('textbox', { name: /名称/ })
    expect(input).toHaveAttribute(
      'aria-describedby',
      'name-description name-error',
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: '负责人' })).not.toHaveAttribute(
      'aria-invalid',
    )
  })

  it('选择框关联标签、说明和错误，并透传禁用状态', () => {
    render(
      <SelectField
        description="选择任务类型"
        disabled
        error="请选择类型"
        id="type"
        label="类型"
      >
        <option>请选择</option>
      </SelectField>,
    )
    const select = screen.getByRole('combobox', { name: '类型' })
    expect(select).toBeDisabled()
    expect(select).toHaveAttribute(
      'aria-describedby',
      'type-description type-error',
    )
  })
})

describe('状态与反馈', () => {
  it.each(taskStatuses)('状态 %s 映射到稳定的中文标签', (status) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(taskStatusMeta[status].label)).toBeInTheDocument()
  })

  it('空状态、错误状态、加载状态和无权限状态语义互不混淆', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(
      <>
        <EmptyState
          action={<button>新建任务</button>}
          description="当前还没有任务"
          title="暂无任务"
        />
        <ErrorState
          action={<button onClick={retry}>重试</button>}
          description="请稍后重试"
        />
        <LoadingState />
        <UnauthorizedState />
      </>,
    )
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载')
    expect(screen.getByText('暂无访问权限')).toBeInTheDocument()
    expect(screen.getByText('暂时无法完成此操作')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('确认对话框', () => {
  function DialogExample({ confirm = vi.fn() }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>打开对话框</button>
        <Dialog
          description="此操作不可撤销"
          onClose={() => setOpen(false)}
          onConfirm={confirm}
          open={open}
          title="确认删除"
        />
      </>
    )
  }

  it('标题和说明由真实元素关联，确认操作只触发一次', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    render(<DialogExample confirm={confirm} />)
    await user.click(screen.getByRole('button', { name: '打开对话框' }))
    const dialog = screen.getByRole('dialog')
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby')!),
    ).toHaveTextContent('确认删除')
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby')!),
    ).toHaveTextContent('此操作不可撤销')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('取消按钮和 Escape 均关闭对话框并恢复触发按钮焦点', async () => {
    const user = userEvent.setup()
    render(<DialogExample />)
    const opener = screen.getByRole('button', { name: '打开对话框' })

    await user.click(opener)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    await user.click(opener)
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
