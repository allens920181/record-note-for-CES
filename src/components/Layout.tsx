import { createContext, useContext, useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar, useSidebarOpen } from './Sidebar'

/** Lets the top bar's toggle reach the sidebar without threading props. */
const SidebarToggle = createContext<(() => void) | null>(null)

export interface Crumb {
  label: string
  to?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="麵包屑">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep">/</span>}
          {c.to ? (
            <Link to={c.to}>{c.label}</Link>
          ) : (
            <span className="here">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/**
 * The bar above the page: where you are, and a handle on the sidebar.
 *
 * The five navigation links used to live here, beside the breadcrumbs, and
 * wrapped onto a second line as soon as the trail got long. They are in the
 * sidebar now — one place for navigation, and room here for the trail.
 */
export function TopBar({ children }: { children?: ReactNode }) {
  const toggle = useContext(SidebarToggle)
  return (
    <header className="topbar">
      <button
        className="side-toggle"
        aria-label="開關側邊欄"
        title="開關側邊欄"
        onClick={() => toggle?.()}
      >
        ☰
      </button>
      {children}
      <span className="spacer" />
    </header>
  )
}

/**
 * The frame that stays put while a page loads or is missing.
 *
 * Returning a bare `<div class="page">載入中…</div>` from a route made the whole
 * top bar vanish and reappear on every navigation, so the app blinked twice for
 * each click. Only the content area should change.
 */
export function PageShell({
  crumbs,
  children,
}: {
  crumbs: Crumb[]
  children: ReactNode
}) {
  return (
    <>
      <TopBar>
        <Breadcrumbs items={crumbs} />
      </TopBar>
      <main className="page">{children}</main>
    </>
  )
}

export function Layout() {
  const [open, setOpen] = useSidebarOpen()
  const { pathname } = useLocation()

  // The workspace is two panes of your own writing; a course tree beside it is
  // 15rem of something you are not looking at. Collapsed on the way in, put
  // back on the way out — and only on the way in, so opening it while you are
  // in there survives stepping to the next week.
  const inside = useRef(pathname.startsWith('/session/'))
  const before = useRef(open)
  useEffect(() => {
    const now = pathname.startsWith('/session/')
    if (now && !inside.current) {
      before.current = open
      setOpen(false)
    } else if (!now && inside.current) {
      // Only our own collapse is undone. Opening it by hand while in the
      // workspace is a decision, and putting it back would overrule it.
      if (!open) setOpen(before.current)
    }
    inside.current = now
    // `open` is read, never depended on: reacting to it would re-collapse the
    // sidebar the moment the reader opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <SidebarToggle.Provider value={() => setOpen(!open)}>
      <div className={`app${open ? ' side-open' : ''}`}>
        <Sidebar
          open={open}
          onClose={() => {
            // Only the narrow layout closes on navigation; on a wide screen the
            // sidebar is part of the furniture and closing it would be a
            // surprise every time you clicked a week.
            if (!window.matchMedia('(min-width: 60rem)').matches) setOpen(false)
          }}
        />
        <div className="app-main">
          <Outlet />
        </div>
      </div>
    </SidebarToggle.Provider>
  )
}
