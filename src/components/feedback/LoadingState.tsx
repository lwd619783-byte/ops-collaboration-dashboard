export function LoadingState({ title = '正在加载' }: { title?: string }) {
  return (
    <div className="loading-state" role="status">
      <span aria-hidden="true" className="loading-spinner" />
      {title}
      <span className="sr-only">请稍候</span>
    </div>
  )
}
