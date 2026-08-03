import { Navigate, Outlet } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useWorkspace } from '@/features/workspaces/WorkspaceContext'

export function WorkspaceRequiredRoute() {
  const { status, currentWorkspace, pendingInvitations, error, refresh } =
    useWorkspace()

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="route-loading">
        <LoadingState title="正在加载工作空间" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="route-loading">
        <ErrorState
          title="暂时无法加载工作空间"
          description={error?.message ?? '操作暂时无法完成，请稍后重试。'}
          action={
            <Button onClick={() => void refresh()} variant="secondary">
              重试
            </Button>
          }
        />
      </div>
    )
  }
  if (currentWorkspace) return <Outlet />
  if (pendingInvitations.length > 0) {
    return <Navigate replace to="/activate-account" />
  }
  return (
    <div className="route-loading">
      <EmptyState
        title="暂无可访问的工作空间"
        description="管理员尚未为此账号启用工作空间。系统不会在浏览器中自动创建工作空间。"
      />
    </div>
  )
}
