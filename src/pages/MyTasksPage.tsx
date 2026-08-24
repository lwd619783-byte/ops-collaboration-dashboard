import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import {
  filterMyTasks,
  isMyTaskView,
  MyTaskCard,
  myTaskViewLabels,
  myTaskViews,
  sortMyTasks,
  useScopedMyTasks,
} from '@/features/tasks'
import { useWorkspace } from '@/features/workspaces'

export function MyTasksPage() {
  const { appUser } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const view = isMyTaskView(requestedView) ? requestedView : 'pending'
  const appUserId = appUser?.id ?? null
  const workspaceId = currentWorkspace?.workspace_id ?? null
  const workspaceRole = currentWorkspace?.role ?? null
  const taskState = useScopedMyTasks(
    appUserId && workspaceId && workspaceRole
      ? { appUserId, workspaceId, workspaceRole }
      : null,
  )
  const visibleTasks = useMemo(
    () => sortMyTasks(filterMyTasks(taskState.tasks, view)),
    [taskState.tasks, view],
  )

  if (!currentWorkspace) return null

  const setView = (nextView: typeof view) => {
    setSearchParams(nextView === 'pending' ? {} : { view: nextView }, {
      replace: true,
    })
  }

  return (
    <div className="page-stack my-tasks-page">
      <section className="intro my-tasks-heading">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>我的任务</h2>
          <p>跨项目查看当前由你负责、协作或需要验收的任务。</p>
        </div>
      </section>

      <div
        aria-label="我的任务筛选"
        className="my-task-view-control"
        role="group"
      >
        {myTaskViews.map((item) => (
          <Button
            aria-pressed={view === item}
            key={item}
            onClick={() => setView(item)}
            variant={view === item ? 'primary' : 'secondary'}
          >
            {myTaskViewLabels[item]}
          </Button>
        ))}
      </div>

      {taskState.status === 'loading' && (
        <LoadingState title="正在加载我的任务" />
      )}
      {taskState.status === 'error' && (
        <ErrorState
          action={
            <Button onClick={taskState.retry} variant="secondary">
              重试
            </Button>
          }
          description={taskState.error ?? '我的任务暂时无法读取，请稍后重试。'}
          title="暂时无法加载我的任务"
        />
      )}
      {taskState.status === 'ready' && visibleTasks.length === 0 && (
        <EmptyState
          description={`当前没有符合“${myTaskViewLabels[view]}”条件的任务。`}
          title="暂无任务"
        />
      )}
      {taskState.status === 'ready' && visibleTasks.length > 0 && (
        <section aria-label={`${myTaskViewLabels[view]}任务列表`}>
          <div className="my-task-card-list">
            {visibleTasks.map((task) => (
              <MyTaskCard key={task.task_id} task={task} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
