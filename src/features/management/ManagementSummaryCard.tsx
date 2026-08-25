import type { ManagementHealth } from '@/features/management/managementWorkbench'

export function ManagementSummaryCard({
  count,
  label,
  note,
  onClick,
  tone,
}: {
  count: number
  label: string
  note: string
  onClick: () => void
  tone: Exclude<ManagementHealth, 'neutral' | 'unknown'> | 'info'
}) {
  return (
    <button
      aria-label={`${label} ${count} 项，查看相关内容`}
      className={`management-summary-card management-summary-${tone}`}
      onClick={onClick}
      type="button"
    >
      <span className="management-summary-label">{label}</span>
      <strong>{count}</strong>
      <span className="management-summary-note">{note}</span>
    </button>
  )
}
