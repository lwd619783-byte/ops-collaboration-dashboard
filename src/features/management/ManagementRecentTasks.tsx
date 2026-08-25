import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { DateDisplay } from '@/components/ui/DateDisplay'
import type { ManagementTaskItem } from '@/features/management/managementWorkbench'
import { taskStatusLabels } from '@/features/tasks/taskMeta'

export function ManagementRecentTasks({
  items,
}: {
  items: readonly ManagementTaskItem[]
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        description="当前已加载项目中还没有可显示的任务。"
        title="暂无近期任务更新"
      />
    )
  }

  return (
    <ol className="management-recent-list">
      {items.map((item) => (
        <li key={item.task.task_id}>
          <div>
            <p>{item.project.name}</p>
            <h3>
              <Link
                to={`/projects/${item.project.project_id}/tasks/${item.task.task_id}`}
              >
                {item.task.title}
              </Link>
            </h3>
            <span>负责人：{item.task.assignee_display_name}</span>
          </div>
          <div className="management-recent-status">
            <Badge className="badge-info">
              {taskStatusLabels[item.task.status]}
            </Badge>
            <DateDisplay kind="date-time" value={item.task.updated_at} />
          </div>
        </li>
      ))}
    </ol>
  )
}
