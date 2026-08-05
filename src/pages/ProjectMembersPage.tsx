import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { SelectField } from '@/components/forms/SelectField'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { Dialog } from '@/components/ui/Dialog'
import { createSafeProjectError } from '@/features/projects/errors'
import {
  projectRoleBadgeClasses,
  projectRoleLabels,
  projectWorkspaceRoleLabels,
} from '@/features/projects/projectMeta'
import {
  useProjects,
  type Project,
  type ProjectMember,
  type ProjectMemberCandidate,
  type ProjectMemberRole,
} from '@/features/projects'
import { useWorkspace } from '@/features/workspaces'

type Action =
  | { kind: 'add' }
  | { kind: 'role'; member: ProjectMember }
  | { kind: 'remove'; member: ProjectMember }
  | { kind: 'lead' }
  | { kind: 'clear-lead' }
  | { kind: 'owner' }

const ordinaryRoles: ProjectMemberRole[] = ['member', 'viewer']

function actionCopy(action: Action | null) {
  switch (action?.kind) {
    case 'add':
      return {
        title: '添加项目成员',
        description: '从当前工作空间已启用的内部用户中选择成员。',
        confirm: '确认添加',
      }
    case 'role':
      return {
        title: '调整普通角色',
        description: `调整“${action.member.display_name}”在本项目中的普通角色。`,
        confirm: '确认调整',
      }
    case 'remove':
      return {
        title: '移除项目成员',
        description: `移除“${action.member.display_name}”后，该用户将立即失去本项目的读取权限。`,
        confirm: '确认移除',
      }
    case 'lead':
      return {
        title: '任命或更换牵头人',
        description:
          '原牵头人将自动降为普通成员；新牵头人会获得项目成员管理权限。',
        confirm: '确认任命',
      }
    case 'clear-lead':
      return {
        title: '清除项目牵头人',
        description: '当前牵头人将自动降为普通成员，项目暂时不再设置牵头人。',
        confirm: '确认清除',
      }
    case 'owner':
      return {
        title: '转让项目负责人',
        description:
          '新负责人将成为唯一 owner，原负责人固定降为普通成员；此变更原子完成。',
        confirm: '确认转让',
      }
    default:
      return { title: '', description: '', confirm: '确认' }
  }
}

export function ProjectMembersPage() {
  const { projectId = '' } = useParams()
  const workspace = useWorkspace()
  const projects = useProjects()
  const currentWorkspace = workspace.currentWorkspace
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [candidates, setCandidates] = useState<ProjectMemberCandidate[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('member')
  const [candidateState, setCandidateState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [isMutating, setMutating] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const requestEpochRef = useRef(0)
  const actionEpochRef = useRef(0)
  const mountedRef = useRef(true)

  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}`
    : null
  const scopeKeyRef = useRef(scopeKey)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
      actionEpochRef.current += 1
    }
  }, [])

  useLayoutEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      requestEpochRef.current += 1
      actionEpochRef.current += 1
      scopeKeyRef.current = scopeKey
    }
  }, [scopeKey])

  const [committedScopeKey, setCommittedScopeKey] = useState(scopeKey)
  if (committedScopeKey !== scopeKey) {
    setCommittedScopeKey(scopeKey)
    setProject(null)
    setMembers([])
    setCandidates([])
    setAction(null)
    setCandidateState('idle')
    setMutationError(null)
    setFeedback(null)
    setMutating(false)
  }

  const currentMember = members.find((member) => member.is_current_user)
  const workspaceCanManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'
  const canManageOrdinary = Boolean(
    project?.status !== 'archived' &&
    (workspaceCanManage ||
      currentMember?.project_role === 'owner' ||
      currentMember?.project_role === 'lead'),
  )
  const canManageLeadership = Boolean(
    project?.status !== 'archived' &&
    (workspaceCanManage || currentMember?.project_role === 'owner'),
  )

  const load = useCallback(async () => {
    if (!currentWorkspace) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKeyRef.current
    setLoadState('loading')
    setLoadError(null)
    setLoadedScopeKey(null)
    const [projectResult, membersResult] = await Promise.all([
      projects.get(projectId),
      projects.listMembers(projectId),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (requestScopeKey !== scopeKeyRef.current) return
    if (!projectResult.ok || !membersResult.ok) {
      setProject(null)
      setMembers([])
      setLoadError(
        !projectResult.ok
          ? projectResult.error.message
          : membersResult.ok
            ? null
            : membersResult.error.message,
      )
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    const wrongProject =
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== currentWorkspace.workspace_id ||
      membersResult.data.some(
        (member) =>
          member.project_id !== projectId ||
          member.workspace_id !== currentWorkspace.workspace_id,
      )
    if (wrongProject) {
      setProject(null)
      setMembers([])
      setLoadError(createSafeProjectError('unknown_service_error').message)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(projectResult.data)
    setMembers(membersResult.data)
    setLoadedScopeKey(requestScopeKey)
    setLoadState('ready')
  }, [currentWorkspace, projectId, projects])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [load])

  const loadCandidates = useCallback(async () => {
    if (!currentWorkspace) return false
    const epoch = requestEpochRef.current
    const actionEpoch = actionEpochRef.current
    const requestScopeKey = scopeKeyRef.current
    setCandidateState('loading')
    const result = await projects.listMemberCandidates(projectId)
    if (!mountedRef.current || requestEpochRef.current !== epoch) return false
    if (
      actionEpochRef.current !== actionEpoch ||
      requestScopeKey !== scopeKeyRef.current
    ) {
      return false
    }
    if (!result.ok) {
      setCandidates([])
      setMutationError(result.error.message)
      setCandidateState('error')
      return false
    }
    if (
      result.data.some(
        (candidate) =>
          candidate.project_id !== projectId ||
          candidate.workspace_id !== currentWorkspace.workspace_id,
      )
    ) {
      setCandidates([])
      setMutationError(createSafeProjectError('unknown_service_error').message)
      setCandidateState('error')
      return false
    }
    setCandidates(result.data)
    setCandidateState('ready')
    return true
  }, [currentWorkspace, projectId, projects])

  const openAction = async (nextAction: Action) => {
    actionEpochRef.current += 1
    setAction(nextAction)
    setMutationError(null)
    setSelectedRole(
      nextAction.kind === 'role'
        ? (nextAction.member.project_role as ProjectMemberRole)
        : 'member',
    )
    setSelectedUserId('')
    if (
      nextAction.kind === 'add' ||
      nextAction.kind === 'lead' ||
      nextAction.kind === 'owner'
    ) {
      setCandidateState('loading')
      await loadCandidates()
    } else {
      setCandidateState('idle')
    }
  }

  const closeAction = () => {
    if (isMutating) return
    actionEpochRef.current += 1
    setAction(null)
    setMutationError(null)
    setCandidates([])
    setCandidateState('idle')
  }

  const submitAction = async () => {
    if (!project || !action || isMutating) return
    const actionEpoch = ++actionEpochRef.current
    const actionScopeKey = scopeKeyRef.current
    const actionProjectId = project.project_id
    const actionWorkspaceId = project.workspace_id
    setMutating(true)
    setMutationError(null)

    let result
    switch (action.kind) {
      case 'add':
        result = await projects.addMember({
          projectId: actionProjectId,
          userId: selectedUserId,
          role: selectedRole,
        })
        break
      case 'role':
        result = await projects.setMemberRole({
          projectId: actionProjectId,
          userId: action.member.app_user_id,
          role: selectedRole,
        })
        break
      case 'remove':
        result = await projects.removeMember({
          projectId: actionProjectId,
          userId: action.member.app_user_id,
        })
        break
      case 'lead':
        result = await projects.setLead({
          projectId: actionProjectId,
          userId: selectedUserId,
          expectedUpdatedAt: project.updated_at,
        })
        break
      case 'clear-lead':
        result = await projects.clearLead({
          projectId: actionProjectId,
          expectedUpdatedAt: project.updated_at,
        })
        break
      case 'owner':
        result = await projects.transferOwner({
          projectId: actionProjectId,
          userId: selectedUserId,
          expectedUpdatedAt: project.updated_at,
        })
        break
    }

    if (!mountedRef.current) return
    if (
      actionEpochRef.current !== actionEpoch ||
      actionScopeKey !== scopeKeyRef.current
    ) {
      return
    }
    if (!result.ok) {
      setMutationError(result.error.message)
      setMutating(false)
      if (
        result.error.code === 'permission_denied' ||
        result.error.code === 'not_found_or_forbidden' ||
        result.error.code === 'project_archived' ||
        result.error.code === 'concurrent_update'
      ) {
        await load()
      }
      return
    }
    if (
      result.data.project_id !== actionProjectId ||
      result.data.workspace_id !== actionWorkspaceId
    ) {
      setMutationError(createSafeProjectError('unknown_service_error').message)
      setMutating(false)
      return
    }

    const feedbackByAction: Record<Action['kind'], string> = {
      add: result.data.changed ? '项目成员已添加。' : '该成员已处于目标角色。',
      role: result.data.changed ? '普通成员角色已更新。' : '成员角色没有变化。',
      remove: result.data.changed
        ? '成员已移除，访问权限已失效。'
        : '该成员已不在项目中。',
      lead: result.data.changed ? '项目牵头人已更新。' : '牵头人没有变化。',
      'clear-lead': result.data.changed
        ? '项目牵头人已清除。'
        : '项目原本未设置牵头人。',
      owner: result.data.changed ? '项目负责人已转让。' : '负责人没有变化。',
    }
    setFeedback(feedbackByAction[action.kind])
    setProject(result.data)
    setAction(null)
    setCandidates([])
    setCandidateState('idle')
    setMutating(false)
    await load()
  }

  const availableCandidates = useMemo(() => {
    if (!action) return []
    if (action.kind === 'add') {
      return candidates.filter(
        (candidate) => candidate.existing_project_role === null,
      )
    }
    if (action.kind === 'lead') {
      return candidates.filter(
        (candidate) => candidate.app_user_id !== project?.owner_id,
      )
    }
    if (action.kind === 'owner') {
      return candidates.filter(
        (candidate) => candidate.app_user_id !== project?.owner_id,
      )
    }
    return []
  }, [action, candidates, project?.owner_id])

  const dialogCopy = actionCopy(action)
  const candidateRequired =
    action?.kind === 'add' ||
    action?.kind === 'lead' ||
    action?.kind === 'owner'
  const confirmDisabled =
    isMutating ||
    (candidateRequired && !selectedUserId) ||
    (action?.kind === 'role' && selectedRole === action.member.project_role)

  if (!currentWorkspace) return null
  const staleScope = loadedScopeKey !== scopeKey
  if (loadState === 'loading' || staleScope) {
    return <LoadingState title="正在加载项目成员" />
  }
  if (loadState === 'error' || !project) {
    return (
      <ErrorState
        action={
          <Button onClick={() => void load()} variant="secondary">
            重试
          </Button>
        }
        description={loadError ?? '项目不存在或你无权访问。'}
        title="无法打开项目成员"
      />
    )
  }

  return (
    <div className="page-stack project-members-page">
      <section className="intro project-members-heading">
        <div>
          <p className="eyebrow">项目成员</p>
          <h2>{project.name}</h2>
          <p>
            共 {members.length}{' '}
            人；负责人唯一，牵头人最多一名。成员目录不返回认证凭据或联系方式。
          </p>
        </div>
        <div className="project-detail-actions">
          <Link
            className="button button-secondary button-md"
            to={`/projects/${project.project_id}`}
          >
            返回项目详情
          </Link>
          {canManageOrdinary && (
            <Button onClick={() => void openAction({ kind: 'add' })}>
              添加成员
            </Button>
          )}
        </div>
      </section>

      {project.status === 'archived' && (
        <p className="project-history-notice" role="status">
          此项目已归档。成员关系仅供历史查看，所有成员写操作均已关闭。
        </p>
      )}
      {feedback && (
        <p aria-live="polite" className="confirmation" role="status">
          {feedback}
        </p>
      )}

      {canManageLeadership && (
        <section
          aria-labelledby="leadership-actions-title"
          className="project-leadership-panel"
        >
          <div>
            <h3 id="leadership-actions-title">负责人和牵头人</h3>
            <p>
              专用操作使用项目版本校验和数据库行锁，避免并发变更产生双负责人或角色漂移。
            </p>
          </div>
          <div className="member-actions">
            <Button
              onClick={() => void openAction({ kind: 'lead' })}
              variant="secondary"
            >
              {project.lead_id ? '更换牵头人' : '任命牵头人'}
            </Button>
            {project.lead_id && (
              <Button
                onClick={() => void openAction({ kind: 'clear-lead' })}
                variant="danger"
              >
                清除牵头人
              </Button>
            )}
            <Button
              onClick={() => void openAction({ kind: 'owner' })}
              variant="danger"
            >
              转让负责人
            </Button>
          </div>
        </section>
      )}

      {members.length === 0 ? (
        <EmptyState
          description="当前项目没有可显示的成员关系。"
          title="暂无项目成员"
        />
      ) : (
        <ul
          aria-label={`${project.name}项目成员列表`}
          className="project-member-list"
        >
          {members.map((member) => {
            const ordinary =
              member.project_role === 'member' ||
              member.project_role === 'viewer'
            return (
              <li className="project-member-card" key={member.app_user_id}>
                <div className="project-member-card-heading">
                  <div>
                    <h3>
                      {member.display_name}
                      {member.is_current_user && (
                        <span className="muted-text">（你）</span>
                      )}
                    </h3>
                    <p>{projectWorkspaceRoleLabels[member.workspace_role]}</p>
                  </div>
                  <div className="project-member-badges">
                    <Badge
                      className={projectRoleBadgeClasses[member.project_role]}
                    >
                      {projectRoleLabels[member.project_role]}
                    </Badge>
                    {!member.is_active && (
                      <Badge className="badge-danger">已停用，仅保留历史</Badge>
                    )}
                  </div>
                </div>
                <p className="project-member-joined">
                  加入时间：
                  <DateDisplay kind="date-time" value={member.joined_at} />
                </p>
                {canManageOrdinary && ordinary && member.is_active && (
                  <div className="member-actions">
                    <Button
                      onClick={() => void openAction({ kind: 'role', member })}
                      size="sm"
                      variant="secondary"
                    >
                      调整角色
                    </Button>
                    <Button
                      onClick={() =>
                        void openAction({ kind: 'remove', member })
                      }
                      size="sm"
                      variant="danger"
                    >
                      移除成员
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        confirmDisabled={confirmDisabled}
        confirmLabel={isMutating ? '正在处理' : dialogCopy.confirm}
        confirmLoading={isMutating}
        danger={
          action?.kind === 'remove' ||
          action?.kind === 'clear-lead' ||
          action?.kind === 'owner'
        }
        description={dialogCopy.description}
        onClose={closeAction}
        onConfirm={() => void submitAction()}
        open={Boolean(action)}
        title={dialogCopy.title}
      >
        {candidateRequired && candidateState === 'loading' && (
          <p aria-live="polite">正在加载可选成员……</p>
        )}
        {candidateRequired &&
          candidateState === 'ready' &&
          (availableCandidates.length > 0 ? (
            <div className="dialog-form">
              <SelectField
                autoFocus
                disabled={isMutating}
                label="选择用户"
                onChange={(event) => setSelectedUserId(event.target.value)}
                required
                value={selectedUserId}
              >
                <option value="">请选择</option>
                {availableCandidates.map((candidate) => (
                  <option
                    key={candidate.app_user_id}
                    value={candidate.app_user_id}
                  >
                    {candidate.display_name} ·{' '}
                    {projectWorkspaceRoleLabels[candidate.workspace_role]}
                    {candidate.existing_project_role
                      ? ` · 当前${projectRoleLabels[candidate.existing_project_role]}`
                      : ' · 尚未加入项目'}
                  </option>
                ))}
              </SelectField>
              {action?.kind === 'add' && (
                <SelectField
                  disabled={isMutating}
                  label="项目角色"
                  onChange={(event) =>
                    setSelectedRole(event.target.value as ProjectMemberRole)
                  }
                  value={selectedRole}
                >
                  {ordinaryRoles.map((role) => (
                    <option key={role} value={role}>
                      {projectRoleLabels[role]}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
          ) : (
            <p className="muted-text" role="status">
              当前没有符合条件的已启用工作空间成员。
            </p>
          ))}
        {action?.kind === 'role' && (
          <SelectField
            autoFocus
            disabled={isMutating}
            label="新项目角色"
            onChange={(event) =>
              setSelectedRole(event.target.value as ProjectMemberRole)
            }
            value={selectedRole}
          >
            {ordinaryRoles.map((role) => (
              <option key={role} value={role}>
                {projectRoleLabels[role]}
              </option>
            ))}
          </SelectField>
        )}
        {mutationError && (
          <p className="form-error" role="alert">
            {mutationError}
          </p>
        )}
      </Dialog>
    </div>
  )
}
