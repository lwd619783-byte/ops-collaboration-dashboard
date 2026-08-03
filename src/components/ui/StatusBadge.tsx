import { Badge } from '@/components/ui/Badge'
import { taskStatusMeta, type TaskStatus } from '@/lib/status/taskStatus'
export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = taskStatusMeta[status]
  return <Badge className={`badge-${meta.tone}`}>{meta.label}</Badge>
}
