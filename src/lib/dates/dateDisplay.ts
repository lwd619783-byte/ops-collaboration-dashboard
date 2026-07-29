const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/
function validDateOnly(value: string) {
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
  if (!value || !validDateOnly(value)) return '—'
  const [, year, month, day] = dateOnlyPattern.exec(value) as RegExpExecArray
  return `${year}年${Number(month)}月${Number(day)}日`
}
export function formatDateTime(
  value?: string | null,
  timeZone = 'Asia/Shanghai',
) {
  if (!value || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date)
}
export function isDateValue(value?: string | null) {
  return Boolean(
    value &&
    (validDateOnly(value) ||
      (/(Z|[+-]\d{2}:\d{2})$/.test(value) &&
        !Number.isNaN(new Date(value).getTime()))),
  )
}
