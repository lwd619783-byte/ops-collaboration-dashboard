import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDateOnly, formatDateTime } from '@/lib/dates/dateDisplay'
describe('基础组件', () => {
  it('loading 和 disabled 按钮不会触发操作', async () => {
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
  it('表单字段关联 label、说明与错误', () => {
    render(
      <>
        <InputField
          description="填写名称"
          error="名称不能为空"
          label="名称"
          required
        />
        <SelectField disabled label="类型">
          <option>请选择</option>
        </SelectField>
      </>,
    )
    const input = screen.getByRole('textbox', { name: /名称/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('description'),
    )
    expect(screen.getByRole('combobox', { name: '类型' })).toBeDisabled()
  })
  it('确认对话框支持取消、确认和 Escape', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    function DialogExample() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>打开对话框</button>
          <Dialog
            description="说明"
            onClose={() => setOpen(false)}
            onConfirm={confirm}
            open={open}
            title="确认操作"
          />
        </>
      )
    }
    render(<DialogExample />)
    const opener = screen.getByRole('button', { name: '打开对话框' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    await user.click(opener)
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('状态映射、日期显示和反馈状态保持明确语义', () => {
    render(
      <>
        <StatusBadge status="blocked" />
        <LoadingState />
        <ErrorState description="请稍后重试" action={<button>重试</button>} />
        <UnauthorizedState />
      </>,
    )
    expect(screen.getByText('已阻塞')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByText('暂无访问权限')).toBeInTheDocument()
    expect(formatDateOnly('2026-07-30')).toBe('2026年7月30日')
    expect(formatDateOnly('2026-02-30')).toBe('—')
    expect(formatDateTime('2026-07-30T16:00:00Z')).toBe('2026年7月31日 00:00')
    expect(formatDateTime('2026-07-30T16:00:00+08:00')).toBe(
      '2026年7月30日 16:00',
    )
    expect(formatDateTime('2026-07-30T16:00:00')).toBe('—')
  })
})
