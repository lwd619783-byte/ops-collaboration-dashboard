import {
  formatTeamLoadHours,
  teamLoadSignalLabels,
  type TeamLoadMember,
} from '@/features/management/teamLoad'

type TeamLoadMemberCardProps = {
  member: TeamLoadMember
}

function projectSummary(member: TeamLoadMember): string {
  const visibleNames = member.projectNames.slice(0, 2).join('、')
  const remainder = member.projectNames.length - 2
  return remainder > 0 ? `${visibleNames} +${remainder}` : visibleNames
}

function hoursSummary(member: TeamLoadMember): string {
  if (member.executionTaskCount === 0) return '当前无执行任务'
  if (member.estimatedTaskCount === 0) {
    return `暂无工时估算 · 覆盖 0/${member.executionTaskCount} 个执行任务`
  }
  return `已知 ${formatTeamLoadHours(member.knownRemainingHours)}h · 覆盖 ${member.estimatedTaskCount}/${member.executionTaskCount} 个执行任务`
}

export function TeamLoadMemberCard({ member }: TeamLoadMemberCardProps) {
  const reasons = [
    member.highPriorityCount > 0
      ? `${member.highPriorityCount} 个高优先级`
      : null,
    member.blockedCount > 0 ? `${member.blockedCount} 个阻塞` : null,
    member.overdueCount > 0 ? `${member.overdueCount} 个逾期` : null,
    member.dueSoonCount > 0 ? `${member.dueSoonCount} 个三天内到期` : null,
  ].filter((reason): reason is string => reason !== null)

  return (
    <article className={`team-load-member-card team-load-${member.signal}`}>
      <div className="team-load-member-heading">
        <div>
          <h3>{member.displayName}</h3>
          <p>
            参与 {member.projectIds.length} 个当前可管理项目
            {member.projectNames.length > 0
              ? ` · ${projectSummary(member)}`
              : ''}
          </p>
        </div>
        <span
          className={`badge team-load-signal team-load-signal-${member.signal}`}
        >
          {teamLoadSignalLabels[member.signal]}
        </span>
      </div>

      <dl className="team-load-metrics">
        <div>
          <dt>执行任务</dt>
          <dd>{member.executionTaskCount}</dd>
        </div>
        <div>
          <dt>高优先级</dt>
          <dd>{member.highPriorityCount}</dd>
        </div>
        <div>
          <dt>阻塞</dt>
          <dd>{member.blockedCount}</dd>
        </div>
        <div>
          <dt>逾期</dt>
          <dd>{member.overdueCount}</dd>
        </div>
        <div>
          <dt>三天内到期</dt>
          <dd>{member.dueSoonCount}</dd>
        </div>
      </dl>

      <p className="team-load-hours">{hoursSummary(member)}</p>
      <div aria-label="负荷原因" className="team-load-reasons">
        {reasons.length > 0 ? (
          reasons.map((reason) => <span key={reason}>{reason}</span>)
        ) : (
          <span>
            {member.executionTaskCount === 0
              ? '当前没有执行任务'
              : '当前无阻塞、逾期、高优先级或临期信号'}
          </span>
        )}
      </div>
    </article>
  )
}
