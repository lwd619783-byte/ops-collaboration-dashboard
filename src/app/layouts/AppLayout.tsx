import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PropsWithChildren,
  type RefObject,
} from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { appNavigation } from '@/app/navigation/appNavigation'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'

function SignOutButton() {
  const { signOut, profile } = useAuth()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    if (isSigningOut) return
    setIsSigningOut(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      // Never leak tokens or raw errors; the provider already cleared local
      // state so protected content is not shown even if the remote call fails.
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="user-menu">
      <div className="user-menu-info">
        <span className="user-menu-name">
          {profile?.display_name ?? '当前用户'}
        </span>
        <span className="user-menu-role">已登录</span>
      </div>
      <Button
        aria-label="退出登录"
        disabled={isSigningOut}
        loading={isSigningOut}
        onClick={() => void handleSignOut()}
        size="sm"
        variant="secondary"
      >
        退出登录
      </Button>
    </div>
  )
}

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
      <SignOutButton />
    </nav>
  )
}

function AppLayoutShell({
  children,
  mainContentRef,
}: PropsWithChildren<{ mainContentRef: RefObject<HTMLElement | null> }>) {
  const location = useLocation()
  const [isMobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const drawerId = useId()
  const openNavigationButtonRef = useRef<HTMLButtonElement>(null)
  const closeNavigationButtonRef = useRef<HTMLButtonElement>(null)
  const title =
    appNavigation.find(
      (item) =>
        item.path === location.pathname ||
        (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)),
    )?.title ?? '页面未找到'

  const closeMobileNavigation = useCallback(() => {
    setMobileNavigationOpen(false)
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMobileNavigationOpen) {
        closeMobileNavigation()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeMobileNavigation, isMobileNavigationOpen])

  useEffect(() => {
    if (!isMobileNavigationOpen) return
    const previousOverflow = document.body.style.overflow
    const openNavigationButton = openNavigationButtonRef.current
    const openedPath = location.pathname
    document.body.style.overflow = 'hidden'
    closeNavigationButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (window.location.pathname === openedPath) {
        openNavigationButton?.focus()
      }
    }
  }, [isMobileNavigationOpen, location.pathname])

  const openMobileNavigation = () => {
    setMobileNavigationOpen(true)
  }

  const focusMainContent = () => {
    mainContentRef.current?.focus()
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        inert={isMobileNavigationOpen}
        onClick={focusMainContent}
      >
        跳到主要内容
      </a>
      <aside className="desktop-sidebar" inert={isMobileNavigationOpen}>
        <Navigation />
      </aside>
      <header className="mobile-topbar" inert={isMobileNavigationOpen}>
        <Button
          aria-controls={drawerId}
          aria-expanded={isMobileNavigationOpen}
          onClick={openMobileNavigation}
          ref={openNavigationButtonRef}
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
          onClick={() => closeMobileNavigation()}
          tabIndex={-1}
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
            onClick={() => closeMobileNavigation()}
            ref={closeNavigationButtonRef}
            size="sm"
            variant="ghost"
          >
            关闭
          </Button>
        </div>
        <Navigation
          label="移动端主导航"
          onNavigate={() => closeMobileNavigation()}
        />
      </aside>
      <div className="app-content" inert={isMobileNavigationOpen}>
        <header className="page-header">
          <p className="eyebrow">协同工作空间</p>
          <h1>{title}</h1>
        </header>
        <main id="main-content" ref={mainContentRef} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { pathname } = useLocation()
  const mainContentRef = useRef<HTMLElement>(null)
  const previousPathRef = useRef(pathname)

  useEffect(() => {
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname
      mainContentRef.current?.focus()
    }
  }, [pathname])

  return (
    <AppLayoutShell key={pathname} mainContentRef={mainContentRef}>
      <Outlet />
    </AppLayoutShell>
  )
}
