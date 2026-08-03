import { Link } from 'react-router'
export function NotFoundPage() {
  return (
    <section className="not-found">
      <p className="eyebrow">404</p>
      <h2>页面未找到</h2>
      <p>您访问的地址不存在或已被移动。</p>
      <Link className="button button-primary button-md" to="/">
        返回工作台
      </Link>
    </section>
  )
}
