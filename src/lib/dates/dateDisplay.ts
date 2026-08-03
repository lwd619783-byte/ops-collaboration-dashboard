const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
export function isDateOnlyValue(value?: string | null): value is string {
  if (!value) return false
  const match = dateOnlyPattern.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return (
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
  )
}
export function formatDateOnly(value?: string | null) {
  if (!isDateOnlyValue(value)) return '—'
  const [year, month, day] = value.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}
export function formatDateTime(
  value?: string | null,
  timeZone = 'Asia/Shanghai',
) {
  if (!isDateTimeValue(value, timeZone)) return '—'
  const date = new Date(value)
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date)
  } catch (error) {
    if (error instanceof RangeError) return '—'
    throw error
  }
}

export function isDateTimeValue(
  value?: string | null,
  timeZone = 'Asia/Shanghai',
): value is string {
  if (!value || !dateTimePattern.test(value)) return false
  if (!isDateOnlyValue(value.slice(0, 10))) return false
  if (Number.isNaN(new Date(value).getTime())) return false
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}
