import {
  formatDateOnly,
  formatDateTime,
  isDateValue,
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
  return (
    <time dateTime={isDateValue(value) ? (value ?? undefined) : undefined}>
      {text}
    </time>
  )
}
