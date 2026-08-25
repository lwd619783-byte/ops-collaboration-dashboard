import { Badge } from '@/components/ui/Badge'
import {
  managementHealthLabels,
  type ManagementHealth,
} from '@/features/management/managementWorkbench'

const healthClasses: Record<ManagementHealth, string> = {
  red: 'badge-danger',
  yellow: 'badge-warning',
  green: 'badge-success',
  neutral: 'badge-neutral',
  unknown: 'badge-info management-health-unknown',
}

export function ManagementHealthBadge({
  health,
}: {
  health: ManagementHealth
}) {
  return (
    <Badge className={healthClasses[health]}>
      {managementHealthLabels[health]}
    </Badge>
  )
}
