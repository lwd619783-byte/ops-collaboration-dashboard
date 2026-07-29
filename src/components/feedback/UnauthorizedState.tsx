import type { ReactNode } from 'react'
export function UnauthorizedState({ action }: { action?: ReactNode }) {
  return (
    <section className="unauthorized-state">
      <h2>暂无访问权限</h2>
      <p>您没有访问此内容所需的权限。</p>
      {action}
    </section>
  )
}
