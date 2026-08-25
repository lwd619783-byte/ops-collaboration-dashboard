import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import {
  managementAttentionKinds,
  managementAttentionLabels,
  type ManagementAttentionKind,
  type ManagementTaskItem,
} from '@/features/management/managementWorkbench'
import { taskPriorityLabels, taskStatusLabels } from '@/features/tasks/taskMeta'

const attentionClasses: Record<ManagementAttentionKind, string> = {
  overdue: 'badge-danger',
  blocked: 'badge-danger',
  pending_review: 'badge-warning',
  stale: 'badge-warning',
}

export function ManagementAttentionList({
  activeKind,
  items,
  onKindChange,
}: {
  activeKind: ManagementAttentionKind
  items: readonly ManagementTaskItem[]
  onKindChange: (kind: ManagementAttentionKind) => void
}) {
  const visibleItems = items.filter((item) =>
    item.attentionKinds.includes(activeKind),
  )

  return (
    <>
      <div
        aria-label="重点事项类型"
        className="management-attention-filters"
        role="group"
      >
        {managementAttentionKinds.map((kind) => (
          <Button
            aria-pressed={activeKind === kind}
            key={kind}
            onClick={() => onKindChange(kind)}
            size="sm"
            variant={activeKind === kind ? 'primary' : 'secondary'}
          >
            {managementAttentionLabels[kind]}
          </Button>
        ))}
      </div>

      {visibleItems.length === 0 ? (
        <EmptyState
          description={`当前已加载项目中没有“${managementAttentionLabels[activeKind]}”任务。`}
          title="暂无重点事项"
        />
      ) : (
        <div
          aria-label={`${managementAttentionLabels[activeKind]}任务列表`}
          className="management-attention-list"
        >
          {visibleItems.map((item) => (
            <article className="management-task-card" key={item.task.task_id}>
              <div className="management-task-heading">
                <div>
                  <p>{item.project.name}</p>
                  <h3>
                    <Link
                      to={`/projects/${item.project.project_id}/tasks/${item.task.task_id}`}
                    >
                      {item.task.title}
                    </Link>
                  </h3>
                </div>
                <Badge className="badge-info">
                  {taskStatusLabels[item.task.status]}
                </Badge>
              </div>

              <div aria-label="异常标签" className="management-task-flags">
                {item.attentionKinds.map((kind) => (
                  <Badge className={attentionClasses[kind]} key={kind}>
                    {managementAttentionLabels[kind]}
                  </Badge>
                ))}
                {item.signals.dueSoon && (
                  <Badge className="badge-info">临近截止</Badge>
                )}
              </div>

              <dl className="management-task-meta">
                <div>
                  <dt>负责人</dt>
                  <dd>{item.task.assignee_display_name}</dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{taskPriorityLabels[item.task.priority]}</dd>
                </div>
                <div>
                  <dt>截止日期</dt>
                  <dd>
                    <DateDisplay value={item.task.due_date} />
                  </dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd>{item.task.progress}%</dd>
                </div>
                <div>
                  <dt>最后更新时间</dt>
                  <dd>
                    <DateDisplay
                      kind="date-time"
                      value={item.task.updated_at}
                    />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
