import {
  formatDateOnly,
  formatDateTime,
  isDateOnlyValue,
  isDateTimeValue,
} from '@/lib/dates/dateDisplay'
export function DateDisplay({
  value,
  kind = 'date-only',
  timeZone,
}: {
  value?: string | null
  kind?: 'date-only' | 'date-time'
  timeZone?: string
}) {
  const text =
    kind === 'date-only'
      ? formatDateOnly(value)
      : formatDateTime(value, timeZone)
  const isValid =
    kind === 'date-only'
      ? isDateOnlyValue(value)
      : isDateTimeValue(value, timeZone)
  return (
    <time dateTime={isValid ? (value ?? undefined) : undefined}>{text}</time>
  )
}
