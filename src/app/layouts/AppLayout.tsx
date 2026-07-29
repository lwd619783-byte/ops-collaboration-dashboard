import { useEffect, useId, useState, type PropsWithChildren } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { appNavigation } from '@/app/navigation/appNavigation'
import { Button } from '@/components/ui/Button'

function Navigation({
  label = '主导航',
  onNavigate,
}: {
  label?: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label={label} className="app-navigation">
      <Link className="brand" to="/" onClick={onNavigate}>
        运维协同看板
      </Link>
      <div className="navigation-list">
        {appNavigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function AppLayout({ children }: PropsWithChildren) {
  const [mobileNavigationPath, setMobileNavigationPath] = useState<
    string | null
  >(null)
  const drawerId = useId()
  const location = useLocation()
  const isMobileNavigationOpen = mobileNavigationPath === location.pathname
  const title =
    appNavigation.find((item) => item.path === location.pathname)?.title ??
    '页面未找到'

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavigationPath(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="desktop-sidebar">
        <Navigation />
      </aside>
      <header className="mobile-topbar">
        <Button
          aria-controls={drawerId}
          aria-expanded={isMobileNavigationOpen}
          onClick={() => setMobileNavigationPath(location.pathname)}
          variant="ghost"
        >
          打开导航
        </Button>
        <span className="mobile-title">{title}</span>
      </header>
      {isMobileNavigationOpen && (
        <button
          aria-label="关闭导航遮罩"
          className="drawer-backdrop"
          onClick={() => setMobileNavigationPath(null)}
        />
      )}
      <aside
        aria-label="移动端导航"
        aria-hidden={!isMobileNavigationOpen}
        className={`mobile-drawer ${isMobileNavigationOpen ? 'is-open' : ''}`}
        id={drawerId}
        inert={!isMobileNavigationOpen}
      >
        <div className="drawer-header">
          <span>导航</span>
          <Button
            aria-label="关闭导航"
            onClick={() => setMobileNavigationPath(null)}
            size="sm"
            variant="ghost"
          >
            关闭
          </Button>
        </div>
        <Navigation
          label="移动端主导航"
          onNavigate={() => setMobileNavigationPath(null)}
        />
      </aside>
      <div className="app-content">
        <header className="page-header">
          <p className="eyebrow">协同工作空间</p>
          <h1>{title}</h1>
        </header>
        <main id="main-content">{children}</main>
      </div>
    </div>
  )
}
