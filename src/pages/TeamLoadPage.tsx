import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import {
  formatTeamLoadHours,
  TeamLoadMemberCard,
  TeamLoadSummaryCard,
  useTeamLoad,
} from '@/features/management'
import { useWorkspace } from '@/features/workspaces'

export function TeamLoadPage() {
  const { appUser } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const state = useTeamLoad(
    appUser && currentWorkspace
      ? {
          appUserId: appUser.id,
          workspaceId: currentWorkspace.workspace_id,
          workspaceRole: currentWorkspace.role,
        }
      : null,
  )

  if (!appUser || !currentWorkspace) return null

  const snapshot = state.snapshot
  const allBundlesFailed =
    state.status === 'ready' &&
    snapshot !== null &&
    snapshot.totalProjectCount > 0 &&
    snapshot.loadedProjectCount === 0
  const knownHoursValue = snapshot
    ? snapshot.summary.executionTaskCount === 0
      ? '当前无任务'
      : snapshot.summary.estimatedTaskCount === 0
        ? '暂无估算'
        : `${formatTeamLoadHours(snapshot.summary.knownRemainingHours)}h`
    : '—'

  return (
    <div className="page-stack team-load-page">
      <section className="intro team-load-heading">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>团队负荷</h2>
          <p>聚合当前可管理项目中成员的执行任务压力。</p>
        </div>
        <Link className="button button-secondary button-md" to="/management">
          返回管理工作台
        </Link>
      </section>

      <aside className="team-load-disclaimer">
        <strong>该视图用于任务调度和风险识别，不是绩效评价。</strong>
        <span>V1 按任务执行负责人统计；协作负荷与验收负荷暂未纳入。</span>
      </aside>

      {state.status === 'loading' && <LoadingState title="正在加载团队负荷" />}
      {state.status === 'error' && (
        <ErrorState
          action={
            <Button onClick={state.retry} variant="secondary">
              重试
            </Button>
          }
          description={state.error ?? '团队负荷暂时无法读取，请稍后重试。'}
          title="暂时无法加载团队负荷"
        />
      )}

      {allBundlesFailed && (
        <ErrorState
          action={
            <Button
              loading={state.isRetryingPartial}
              onClick={state.retryPartial}
              variant="secondary"
            >
              重试失败项目
            </Button>
          }
          description={`0 / ${snapshot.totalProjectCount} 个可管理项目成功加载，无法安全生成团队汇总。`}
          title="团队负荷数据暂时不可用"
        />
      )}

      {state.status === 'ready' &&
        snapshot &&
        snapshot.totalProjectCount === 0 && (
          <EmptyState
            description="团队负荷只统计当前用户有管理权限的项目。你仍可在项目和我的任务页面查看已有权限的内容。"
            title="当前没有可管理的项目"
          />
        )}

      {state.status === 'ready' &&
        snapshot &&
        snapshot.loadedProjectCount > 0 && (
          <>
            {snapshot.hasPartialFailure && (
              <section
                aria-live="polite"
                className="management-partial-warning"
                role="status"
              >
                <div>
                  <strong>PARTIAL DATA · 部分项目数据暂时无法读取</strong>
                  <p>
                    已加载 {snapshot.loadedProjectCount} /{' '}
                    {snapshot.totalProjectCount}{' '}
                    个可管理项目；当前汇总只包含成功加载的项目，失败项目不会产生“低负荷”或“0
                    任务”判断。
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
              aria-labelledby="team-load-summary-heading"
              className="management-section"
            >
              <div className="management-section-heading">
                <h2 id="team-load-summary-heading">团队摘要</h2>
                <p>
                  {snapshot.hasPartialFailure
                    ? '以下数字基于成功加载的项目。'
                    : `已加载全部 ${snapshot.totalProjectCount} 个可管理项目。`}
                </p>
              </div>
              <div className="team-load-summary-grid">
                <TeamLoadSummaryCard
                  label="成员数"
                  note="跨项目按成员去重"
                  value={snapshot.summary.memberCount}
                />
                <TeamLoadSummaryCard
                  label="当前执行任务"
                  note="不含待验收、已完成和已取消"
                  value={snapshot.summary.executionTaskCount}
                />
                <TeamLoadSummaryCard
                  label="高优先级任务"
                  note="紧急与高优先级"
                  tone="yellow"
                  value={snapshot.summary.highPriorityCount}
                />
                <TeamLoadSummaryCard
                  label="阻塞 / 逾期任务"
                  note="直接风险信号"
                  tone="red"
                  value={`${snapshot.summary.blockedCount} / ${snapshot.summary.overdueCount}`}
                />
                <TeamLoadSummaryCard
                  label="已知剩余工时"
                  note={`覆盖 ${snapshot.summary.estimatedTaskCount}/${snapshot.summary.executionTaskCount} 个执行任务`}
                  tone="green"
                  value={knownHoursValue}
                />
              </div>
            </section>

            <section
              aria-labelledby="team-load-members-heading"
              className="management-section"
            >
              <div className="management-section-heading">
                <h2 id="team-load-members-heading">成员负荷</h2>
                <p>
                  默认排序仅帮助定位当前任务压力，不代表绩效排序。缺失工时估算保持为未知，不按
                  0 小时计算。
                </p>
              </div>
              {snapshot.members.length === 0 ? (
                <EmptyState
                  description="成功加载的可管理项目中没有 active project member。"
                  title="当前没有团队成员"
                />
              ) : (
                <ul aria-label="成员负荷列表" className="team-load-member-grid">
                  {snapshot.members.map((member) => (
                    <li key={member.appUserId}>
                      <TeamLoadMemberCard member={member} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
    </div>
  )
}
