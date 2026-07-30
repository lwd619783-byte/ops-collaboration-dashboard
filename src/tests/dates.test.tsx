import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DateDisplay } from '@/components/ui/DateDisplay'
import {
  formatDateOnly,
  formatDateTime,
  isDateOnlyValue,
  isDateTimeValue,
} from '@/lib/dates/dateDisplay'

describe('日期语义', () => {
  it('严格校验日期并正确处理闰年', () => {
    expect(isDateOnlyValue('2024-02-29')).toBe(true)
    expect(formatDateOnly('2024-02-29')).toBe('2024年2月29日')
    expect(isDateOnlyValue('2025-02-29')).toBe(false)
    expect(formatDateOnly('2025-02-29')).toBe('—')
    expect(formatDateOnly('2026-02-30')).toBe('—')
  })

  it('按 Asia/Shanghai 正确处理 UTC 跨日与显式偏移量', () => {
    expect(formatDateTime('2026-07-30T16:00:00Z')).toBe('2026年7月31日 00:00')
    expect(formatDateTime('2026-07-30T16:00:00+08:00')).toBe(
      '2026年7月30日 16:00',
    )
  })

  it('拒绝无时区、无效日期和无效时区且不会抛异常', () => {
    expect(isDateTimeValue('2026-07-30T16:00:00')).toBe(false)
    expect(formatDateTime('2026-07-30T16:00:00')).toBe('—')
    expect(formatDateTime('2026-02-30T16:00:00Z')).toBe('—')
    expect(formatDateTime('2026-07-30Z')).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
    expect(formatDateTime('2026-07-30T16:00:00Z', 'Invalid/Zone')).toBe('—')
  })

  it('DateDisplay 只为与 kind 匹配的有效值输出 dateTime', () => {
    render(
      <>
        <DateDisplay kind="date-only" value="2026-07-30" />
        <DateDisplay kind="date-time" value="2026-07-30T16:00:00Z" />
        <DateDisplay kind="date-only" value="2026-07-30T16:00:00Z" />
        <DateDisplay kind="date-time" value="2026-07-30" />
      </>,
    )
    const values = screen.getAllByText(/2026|—/)
    expect(values[0]).toHaveAttribute('dateTime', '2026-07-30')
    expect(values[1]).toHaveAttribute('dateTime', '2026-07-30T16:00:00Z')
    expect(values[2]).not.toHaveAttribute('dateTime')
    expect(values[3]).not.toHaveAttribute('dateTime')
  })
})
