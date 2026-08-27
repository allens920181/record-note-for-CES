import { Link, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'

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

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        神學院錄音筆記
      </Link>
      {children}
      <span className="spacer" />
      <Link to="/settings" className="btn ghost sm">
        設定
      </Link>
    </header>
  )
}

export function Layout() {
  return (
    <div className="app">
      <Outlet />
    </div>
  )
}
