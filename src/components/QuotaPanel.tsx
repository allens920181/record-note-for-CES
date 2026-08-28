import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, quotaState } from '../db'
import type { QuotaState } from '../db'
import { FREE_TIER } from '../db/schema'
import { formatQuota } from '../lib/time'

function Meter({ label, used, cap, unitLabel }: { label: string; used: number; cap: number; unitLabel: string }) {
  const pct = Math.min(100, Math.round((used / cap) * 100))
  // Status colours, not the accent: this is a state, not a series.
  const tone = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--accent)'
  return (
    <div style={{ marginBottom: '.9rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '.3rem' }}>
        <span className="small" style={{ flex: '1 1 auto' }}>
          {label}
        </span>
        <span className="small mono muted" style={{ flex: '0 0 auto' }}>
          {unitLabel}
        </span>
      </div>
      <div className="progress">
        <div style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  )
}

export function QuotaPanel() {
  const [quota, setQuota] = useState<QuotaState | null>(null)

  // Any new usage row means the numbers moved.
  const usageCount = useLiveQuery(() => db.usage.count(), [])
  const allUsage = useLiveQuery(() => db.usage.toArray(), [])

  useEffect(() => {
    void quotaState().then(setQuota)
  }, [usageCount])

  const totalSeconds = (allUsage ?? []).filter((u) => u.ok).reduce((s, u) => s + u.seconds, 0)

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>轉錄用量</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        對照免費層的額度。轉錄前如果這份錄音超得過去，程式會先問你。
      </p>

      {quota === null ? (
        <div className="small muted">載入中…</div>
      ) : (
        <>
          <Meter
            label="今天已用"
            used={quota.usedToday}
            cap={FREE_TIER.secondsPerDay}
            unitLabel={`${formatQuota(quota.usedToday)} / 8 小時 · 剩 ${formatQuota(quota.remainingToday)}`}
          />
          {/* The hourly cap is met once a term at most, so it earns a bar
              only while it is close; otherwise it is a line among the rest. */}
          {quota.usedThisHour >= FREE_TIER.secondsPerHour * 0.7 ? (
            <Meter
              label="這一小時已用"
              used={quota.usedThisHour}
              cap={FREE_TIER.secondsPerHour}
              unitLabel={`${formatQuota(quota.usedThisHour)} / 2 小時 · 剩 ${formatQuota(quota.remainingThisHour)}`}
            />
          ) : null}
          <p className="small muted" style={{ marginTop: '.9rem' }}>
            這一小時 {formatQuota(quota.usedThisHour)} / 2 小時 · 今日請求{' '}
            {quota.requestsToday} / {FREE_TIER.requestsPerDay} 次 · 累計轉錄{' '}
            {formatQuota(totalSeconds)}
          </p>
        </>
      )}
    </section>
  )
}
