import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSettings } from '../db'
import { regrantPermission, rootName, rootStatus } from '../storage/fsRoot'
import type { RootStatus } from '../storage/fsRoot'

/** Dismissal is per-browser and only ever hides a reminder, so localStorage is enough. */
const DISMISSED = 'ces:setup-dismissed'

interface Step {
  done: boolean
  label: string
  detail: string
  action?: { label: string; to?: string; onClick?: () => void }
}

/**
 * The two things that must be done before anything can be recorded or
 * transcribed, said on the first screen instead of the fifth.
 *
 * A banner, not a wizard: writing notes needs neither of these, and a modal
 * standing between a student and their notes on the first morning would be the
 * wrong trade. It disappears on its own once both are done.
 */
export function SetupBanner() {
  const [status, setStatus] = useState<RootStatus | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1'
    } catch {
      return false
    }
  })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [s, n, settings] = await Promise.all([rootStatus(), rootName(), getSettings()])
    setStatus(s)
    // A handle can carry an empty name; `?? '—'` would only catch null and
    // leave 「」 on screen.
    setFolder(n && n.trim() ? n : null)
    setVerified(Boolean(settings.sttVerifiedAt))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (dismissed || status === null || verified === null) return null

  const storageDone = status === 'ready'
  if (storageDone && verified) return null

  const steps: Step[] = [
    {
      done: storageDone,
      label: '選一個存音檔的位置',
      detail:
        status === 'needs-permission'
          ? `${folder ? `資料夾「${folder}」` : '選好的資料夾'}還在，但瀏覽器重開後需要你再授權一次。`
          : status === 'ready'
            ? `目前存到：${folder ?? '瀏覽器內建空間'}`
            : '一學期約需 4.5 GB，所以本機資料夾是必要的；瀏覽器內建空間的配額通常撐不住。',
      action:
        status === 'needs-permission'
          ? {
              label: busy ? '授權中…' : '重新授權',
              onClick: () => {
                setBusy(true)
                void regrantPermission()
                  .then(() => refresh())
                  .finally(() => setBusy(false))
              },
            }
          : { label: '去設定', to: '/settings' },
    },
    {
      done: verified,
      label: '填入轉錄用的 API key',
      detail: verified
        ? '已測試過連線。'
        : '到 console.groq.com 申請，免費層每日 8 小時音訊。填完按「測試連線」確認可用。',
      action: { label: '去設定', to: '/settings' },
    },
  ]

  const left = steps.filter((s) => !s.done).length

  return (
    <div className="setup-banner">
      <div className="row" style={{ alignItems: 'baseline', gap: '.5rem' }}>
        <strong className="grow">要開始錄音與轉錄，還差 {left} 件事</strong>
        <button
          className="btn ghost sm"
          style={{ flex: '0 0 auto' }}
          title="不再顯示這條提醒"
          onClick={() => {
            setDismissed(true)
            try {
              localStorage.setItem(DISMISSED, '1')
            } catch {
              // A private window refusing storage only means it comes back next time.
            }
          }}
        >
          ✕
        </button>
      </div>
      <p className="small muted" style={{ margin: '.2rem 0 .7rem' }}>
        寫筆記不需要這兩樣，現在就可以開始記；要錄音或上傳音檔才會用到。
      </p>
      <ol className="setup-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'is-done' : ''}>
            <span className="mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="grow">
              <span className="what">{s.label}</span>
              <span className="why">{s.detail}</span>
            </span>
            {!s.done && s.action && (
              s.action.to ? (
                <Link className="btn sm" to={s.action.to}>
                  {s.action.label}
                </Link>
              ) : (
                <button className="btn sm" disabled={busy} onClick={s.action.onClick}>
                  {s.action.label}
                </button>
              )
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
