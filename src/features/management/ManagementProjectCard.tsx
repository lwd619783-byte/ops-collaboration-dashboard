import { Link } from 'react-router'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { ManagementHealthBadge } from '@/features/management/ManagementHealthBadge'
import type { ManagementProjectView } from '@/features/management/managementWorkbench'
import { ProjectStatusBadge } from '@/features/projects'

function metricValue(value: number | undefined): string {
  return value === undefined ? '数据不完整' : String(value)
}

export function ManagementProjectCard({
  item,
}: {
  item: ManagementProjectView
}) {
  const { project, metrics } = item
  return (
    <article
      className={`management-project-card management-project-${item.health}`}
    >
      <div className="management-project-heading">
        <div>
          <h3>
            <Link to={`/projects/${project.project_id}`}>{project.name}</Link>
          </h3>
          <div className="management-project-badges">
            <ProjectStatusBadge status={project.status} />
            <ManagementHealthBadge health={item.health} />
          </div>
        </div>
      </div>

      <dl className="management-project-meta">
        <div>
          <dt>项目负责人</dt>
          <dd>{project.owner_display_name}</dd>
        </div>
        <div>
          <dt>项目牵头人</dt>
          <dd>{project.lead_display_name ?? '暂未设置'}</dd>
        </div>
        <div>
          <dt>截止日期</dt>
          <dd>
            <DateDisplay value={project.due_date} />
          </dd>
        </div>
        <div>
          <dt>任务进度</dt>
          <dd className="management-project-progress">
            {metrics ? (
              <>
                <progress
                  aria-label={`${project.name}任务进度 ${metrics.progressPercent}%`}
                  max={100}
                  value={metrics.progressPercent}
                />
                <span>{metrics.progressPercent}%</span>
              </>
            ) : (
              '数据不完整'
            )}
          </dd>
        </div>
      </dl>

      <dl className="management-project-counts">
        <div>
          <dt>逾期</dt>
          <dd>{metricValue(metrics?.overdueCount)}</dd>
        </div>
        <div>
          <dt>阻塞</dt>
          <dd>{metricValue(metrics?.blockedCount)}</dd>
        </div>
        <div>
          <dt>待验收</dt>
          <dd>{metricValue(metrics?.pendingReviewCount)}</dd>
        </div>
        <div>
          <dt>长期未更新</dt>
          <dd>{metricValue(metrics?.staleCount)}</dd>
        </div>
      </dl>

      {item.taskLoadError && (
        <p className="management-project-warning">
          任务数据暂时无法读取，本项目不会被误判为正常。
        </p>
      )}
    </article>
  )
}
