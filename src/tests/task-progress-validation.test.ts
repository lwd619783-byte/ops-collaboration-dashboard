import { describe, expect, it } from 'vitest'
import {
  currentLocalCalendarDate,
  validateTaskProgressForm,
} from '@/features/tasks/validation'
import type { TaskProgressFormValues } from '@/features/tasks'

const validValues: TaskProgressFormValues = {
  recordDate: '2026-08-10',
  completedContent: 'Fictional completed work',
  progress: '100',
  issues: '',
  nextSteps: 'Fictional next step',
  needsAssistance: false,
  markBlocked: false,
  blockerReason: '',
}

class UtcBoundaryDate extends Date {
  override getFullYear() {
    return 2026
  }
  override getMonth() {
    return 7
  }
  override getDate() {
    return 10
  }
  override toISOString() {
    return '2026-08-09T16:30:00.000Z'
  }
}

describe('任务每日进展表单', () => {
  it('业务日期使用本地日历字段，不从 UTC ISO 日期截取', () => {
    const boundary = new UtcBoundaryDate('2026-08-09T16:30:00.000Z')
    expect(boundary.toISOString().slice(0, 10)).toBe('2026-08-09')
    expect(currentLocalCalendarDate(boundary)).toBe('2026-08-10')
  })

  it('允许 100% 保持执行态并校验必填、整数范围和空白内容', () => {
    expect(validateTaskProgressForm(validValues, 'in_progress')).toEqual({})
    expect(
      validateTaskProgressForm(
        { ...validValues, completedContent: '   ', progress: '101' },
        'in_progress',
      ),
    ).toMatchObject({
      completedContent: '请填写今日完成内容。',
      progress: '当前完成比例须为 0–100 的整数。',
    })
    expect(
      validateTaskProgressForm(
        { ...validValues, progress: '1.5' },
        'in_progress',
      ).progress,
    ).toBe('当前完成比例须为 0–100 的整数。')
  })

  it('同时标记阻塞要求原因，已阻塞任务拒绝重复 block 意图', () => {
    expect(
      validateTaskProgressForm(
        { ...validValues, markBlocked: true, blockerReason: '   ' },
        'in_progress',
      ).blockerReason,
    ).toBe('请填写阻塞原因。')
    expect(
      validateTaskProgressForm(
        {
          ...validValues,
          markBlocked: true,
          blockerReason: 'Fictional blocker',
        },
        'blocked',
      ).markBlocked,
    ).toBe('已阻塞任务不能重复标记阻塞。')
  })
})
