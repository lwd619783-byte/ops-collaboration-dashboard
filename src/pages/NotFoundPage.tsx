import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="max-w-xl space-y-5">
      <p className="text-sm font-medium text-sky-700">404</p>
      <h1 className="text-3xl font-bold tracking-tight">页面未找到</h1>
      <p className="leading-7 text-slate-600">您访问的页面不存在或已被移动。</p>
      <Link
        className="inline-flex rounded-md bg-sky-700 px-4 py-2 font-medium text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        to="/"
      >
        返回首页
      </Link>
    </section>
  )
}
