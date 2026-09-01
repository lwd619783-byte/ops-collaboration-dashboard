type TeamLoadSummaryCardProps = {
  label: string
  value: string | number
  note: string
  tone?: 'red' | 'yellow' | 'green' | 'info'
}

export function TeamLoadSummaryCard({
  label,
  value,
  note,
  tone = 'info',
}: TeamLoadSummaryCardProps) {
  return (
    <article className={`team-load-summary-card team-load-summary-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}
