import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <EmptyState
      title={title}
      description="此页面将在后续独立任务中实现，目前仅提供静态页面骨架。"
      action={
        <Link className="text-link" to="/">
          返回工作台
        </Link>
      }
    />
  )
}
