import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { taskPriorityLabels, taskStatusLabels } from '@/features/tasks/taskMeta'
import type { MyTaskSummary, TaskStatus } from '@/features/tasks/types'

const statusTone: Record<TaskStatus, string> = {
  todo: 'badge-info',
  in_progress: 'badge-info',
  blocked: 'badge-danger',
  pending_review: 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-neutral',
}

function taskResponsibilityLabels(task: MyTaskSummary): string[] {
  const labels: string[] = []
  if (task.is_assignee) labels.push('负责人')
  if (task.is_collaborator) labels.push('协作人')
  if (task.status === 'pending_review' && task.can_decide_review) {
    labels.push('待我验收')
  } else if (task.is_reviewer) {
    labels.push('验收人')
  }
  return labels
}

export function MyTaskCard({ task }: { task: MyTaskSummary }) {
  const responsibilities = taskResponsibilityLabels(task)
  return (
    <article className="my-task-card">
      <div className="my-task-card-heading">
        <div>
          <p className="my-task-project">{task.project_name}</p>
          <h3>
            <Link to={`/projects/${task.project_id}/tasks/${task.task_id}`}>
              {task.title}
            </Link>
          </h3>
        </div>
        <Badge className={statusTone[task.status]}>
          {taskStatusLabels[task.status]}
        </Badge>
      </div>
      <div className="my-task-responsibilities" aria-label="当前责任关系">
        {responsibilities.map((label) => (
          <Badge className="badge-neutral" key={label}>
            {label}
          </Badge>
        ))}
      </div>
      <dl className="my-task-meta">
        <div>
          <dt>模块</dt>
          <dd>{task.module_name}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{taskPriorityLabels[task.priority]}</dd>
        </div>
        <div>
          <dt>截止日期</dt>
          <dd>
            <DateDisplay value={task.due_date} />
          </dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd className="my-task-progress">
            <progress
              aria-label={`${task.title}进度 ${task.progress}%`}
              max={100}
              value={task.progress}
            />
            <span>{task.progress}%</span>
          </dd>
        </div>
      </dl>
    </article>
  )
}
