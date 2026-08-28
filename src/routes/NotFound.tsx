import { Link, useLocation } from 'react-router-dom'
import { PageShell } from '../components/Layout'

/**
 * A wrong address said out loud.
 *
 * The catch-all used to render the dashboard silently while the URL stayed on
 * the bad path — so a stale bookmark or a typo looked like the app had simply
 * forgotten everything, and reloading gave the same thing again.
 */
export function NotFound() {
  const { pathname } = useLocation()
  return (
    <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '找不到頁面' }]}>
      <div className="empty">
        <p>
          找不到 <code>#{pathname}</code> 這個頁面。
          <br />
          可能是舊的書籤，或是連結打錯了。
        </p>
        <Link className="btn primary" to="/">
          回到學期列表
        </Link>
      </div>
    </PageShell>
  )
}
