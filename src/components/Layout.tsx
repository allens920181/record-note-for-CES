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
      {/* Grouped so the links wrap onto a second line together rather than one
          at a time — five of them no longer fit beside a breadcrumb trail in a
          narrow window. */}
      <nav className="topnav" aria-label="主導覽">
        <Link to="/search" className="btn ghost sm">
          搜尋
        </Link>
        <Link to="/glossary" className="btn ghost sm">
          詞彙表
        </Link>
        <Link to="/calendar" className="btn ghost sm">
          行事曆
        </Link>
        <Link to="/assignments" className="btn ghost sm">
          作業
        </Link>
        <Link to="/settings" className="btn ghost sm">
          設定
        </Link>
      </nav>
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
