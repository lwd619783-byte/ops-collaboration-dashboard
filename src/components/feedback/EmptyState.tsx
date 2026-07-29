import type { ReactNode } from 'react'
export function EmptyState({
  action,
  description,
  title,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="empty-state">
      <div aria-hidden="true" className="empty-mark">
        —
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}
