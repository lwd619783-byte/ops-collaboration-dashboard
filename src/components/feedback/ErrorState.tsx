import type { ReactNode } from 'react'
export function ErrorState({
  action,
  description,
  title = '暂时无法完成此操作',
}: {
  title?: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="error-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}
