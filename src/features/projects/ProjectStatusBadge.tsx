import { Badge } from '@/components/ui/Badge'
import {
  projectStatusBadgeClasses,
  projectStatusLabels,
} from '@/features/projects/projectMeta'
import type { ProjectStatus } from '@/features/projects/types'

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={projectStatusBadgeClasses[status]}>
      {projectStatusLabels[status]}
    </Badge>
  )
}
