import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import {
  ManagementAttentionList,
  ManagementProjectCard,
  ManagementRecentTasks,
  ManagementSummaryCard,
  type ManagementAttentionKind,
  useManagementWorkbench,
} from '@/features/management'
import { useWorkspace } from '@/features/workspaces'

export function ManagementWorkbenchPage() {
  const { appUser } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const [attentionKind, setAttentionKind] =
    useState<ManagementAttentionKind>('overdue')
  const projectSectionRef = useRef<HTMLElement>(null)
  const attentionSectionRef = useRef<HTMLElement>(null)
  const state = useManagementWorkbench(
    appUser && currentWorkspace
      ? {
          appUserId: appUser.id,
          workspaceId: currentWorkspace.workspace_id,
          workspaceRole: currentWorkspace.role,
        }
      : null,
  )

  if (!appUser || !currentWorkspace) return null

  const scrollTo = (target: HTMLElement | null) => {
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const showAttention = (kind: ManagementAttentionKind) => {
    setAttentionKind(kind)
    scrollTo(attentionSectionRef.current)
  }

  return (
    <div className="page-stack management-workbench-page">
      <section className="intro management-workbench-heading">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>管理工作台</h2>
          <p>聚合当前负责项目的风险、异常和近期任务动态。</p>
        </div>
        <Link className="button button-secondary button-md" to="/team-load">
          查看团队负荷
        </Link>
      </section>

      {state.status === 'loading' && (
        <LoadingState title="正在加载管理工作台" />
      )}
      {state.status === 'error' && (
        <ErrorState
          action={
            <Button onClick={state.retry} variant="secondary">
              重试
            </Button>
          }
          description={state.error ?? '管理工作台暂时无法读取，请稍后重试。'}
          title="暂时无法加载管理工作台"
        />
      )}

      {state.status === 'ready' &&
        state.snapshot &&
        state.snapshot.projects.length === 0 && (
          <EmptyState
            description="你仍可在项目和我的任务页面查看已有权限的内容。"
            title="当前没有可管理的项目"
          />
        )}

      {state.status === 'ready' &&
        state.snapshot &&
        state.snapshot.projects.length > 0 && (
          <>
            {state.snapshot.hasPartialFailure && (
              <section
                aria-live="polite"
                className="management-partial-warning"
                role="status"
              >
                <div>
                  <strong>部分项目数据暂时无法读取</strong>
                  <p>
                    已加载 {state.snapshot.loadedProjectCount} /{' '}
                    {state.snapshot.totalProjectCount}{' '}
                    个项目；汇总仅包含成功读取的项目，失败项目标记为“数据不完整”。
                  </p>
                </div>
                <Button
                  loading={state.isRetryingPartial}
                  onClick={state.retryPartial}
                  size="sm"
                  variant="secondary"
                >
                  重试失败项目
                </Button>
              </section>
            )}

            <section
              aria-labelledby="management-summary-heading"
              className="management-section"
            >
              <div className="management-section-heading">
                <div>
                  <h2 id="management-summary-heading">管理摘要</h2>
                  <p>
                    {state.snapshot.hasPartialFailure
                      ? '以下任务数字基于已成功加载的项目。'
                      : '汇总当前全部可管理项目。'}
                  </p>
                </div>
              </div>
              <div className="management-summary-grid">
                <ManagementSummaryCard
                  count={state.snapshot.summary.redProjects}
                  label="高风险项目"
                  note="查看项目健康度"
                  onClick={() => scrollTo(projectSectionRef.current)}
                  tone="red"
                />
                <ManagementSummaryCard
                  count={state.snapshot.summary.yellowProjects}
                  label="需关注项目"
                  note="查看项目健康度"
                  onClick={() => scrollTo(projectSectionRef.current)}
                  tone="yellow"
                />
                <ManagementSummaryCard
                  count={state.snapshot.summary.overdueTasks}
                  label="逾期任务"
                  note="打开重点事项"
                  onClick={() => showAttention('overdue')}
                  tone="red"
                />
                <ManagementSummaryCard
                  count={state.snapshot.summary.blockedTasks}
                  label="阻塞任务"
                  note="打开重点事项"
                  onClick={() => showAttention('blocked')}
                  tone="red"
                />
                <ManagementSummaryCard
                  count={state.snapshot.summary.pendingReviewTasks}
                  label="待验收任务"
                  note="打开重点事项"
                  onClick={() => showAttention('pending_review')}
                  tone="yellow"
                />
                <ManagementSummaryCard
                  count={state.snapshot.summary.staleTasks}
                  label="长期未更新任务"
                  note="打开重点事项"
                  onClick={() => showAttention('stale')}
                  tone="info"
                />
              </div>
            </section>

            <section
              aria-labelledby="management-projects-heading"
              className="management-section"
              ref={projectSectionRef}
            >
              <div className="management-section-heading">
                <div>
                  <h2 id="management-projects-heading">项目健康度</h2>
                  <p>
                    共 {state.snapshot.totalProjectCount}{' '}
                    个当前可管理项目；数据不完整项目不会显示为正常。
                  </p>
                </div>
              </div>
              <div className="management-project-grid">
                {state.snapshot.projects.map((item) => (
                  <ManagementProjectCard
                    item={item}
                    key={item.project.project_id}
                  />
                ))}
              </div>
            </section>

            <section
              aria-labelledby="management-attention-heading"
              className="management-section"
              ref={attentionSectionRef}
            >
              <div className="management-section-heading">
                <div>
                  <h2 id="management-attention-heading">重点事项</h2>
                  <p>按异常类型定位任务，点击后直接进入任务详情。</p>
                </div>
              </div>
              <ManagementAttentionList
                activeKind={attentionKind}
                items={state.snapshot.attentionItems}
                onKindChange={setAttentionKind}
              />
            </section>

            <section
              aria-labelledby="management-recent-heading"
              className="management-section"
            >
              <div className="management-section-heading">
                <div>
                  <h2 id="management-recent-heading">近期任务更新</h2>
                  <p>
                    按任务最后更新时间倒序展示；不将更新时间伪装为审计事件。
                    {state.snapshot.hasPartialFailure
                      ? ' 当前列表不包含读取失败的项目。'
                      : ''}
                  </p>
                </div>
              </div>
              <ManagementRecentTasks items={state.snapshot.recentTasks} />
            </section>
          </>
        )}
    </div>
  )
}
