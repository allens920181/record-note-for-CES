import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Term } from '../db'
import { todayISO } from '../lib/dates'

/**
 * Which semester the term-scoped pages are looking at.
 *
 * Shared because four pages ask the same question and used to answer it four
 * different ways — three of them by taking the most recently *created* term,
 * which quietly hides the term you are actually in the moment you plan ahead
 * and create the next one.
 */

const REMEMBERED = 'ces:term'

/** The term containing today, else the one starting soonest, else the newest. */
export function defaultTermId(terms: Term[]): string {
  if (terms.length === 0) return ''
  const today = todayISO()
  const current = terms.find((t) => t.startDate <= today && today <= t.endDate)
  if (current) return current.id
  const upcoming = [...terms].filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))
  if (upcoming.length > 0) return upcoming[0].id
  return [...terms].sort((a, b) => b.startDate.localeCompare(a.startDate))[0].id
}

/**
 * Returns the chosen term id and a setter, remembering the choice for the rest
 * of the visit so switching semester on one page carries to the others.
 *
 * `undefined` while the term list is still loading — callers must not treat
 * that as "no term", or they will run their queries against nothing and render
 * an empty state that is really a loading state.
 */
export function useTermChoice(): {
  termId: string | undefined
  setTermId: (id: string) => void
  terms: Term[] | undefined
} {
  const terms = useLiveQuery(() => db.terms.toArray(), [])
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(REMEMBERED)
    } catch {
      return null
    }
  })

  // Drop a remembered id whose term has since been deleted.
  useEffect(() => {
    if (!terms || !chosen) return
    if (!terms.some((t) => t.id === chosen)) setChosen(null)
  }, [terms, chosen])

  const setTermId = (id: string) => {
    setChosen(id)
    try {
      sessionStorage.setItem(REMEMBERED, id)
    } catch {
      // A private window refusing storage only costs the cross-page memory.
    }
  }

  if (!terms) return { termId: undefined, setTermId, terms }
  const valid = chosen && terms.some((t) => t.id === chosen) ? chosen : defaultTermId(terms)
  return { termId: valid, setTermId, terms }
}

interface Props {
  termId: string | undefined
  terms: Term[] | undefined
  onChange: (id: string) => void
  id?: string
  label?: string
  /** Hide the control when there is only one term — it would be pure noise. */
  hideWhenSingle?: boolean
}

export function TermPicker({ termId, terms, onChange, id = 'term-pick', label = '學期', hideWhenSingle = true }: Props) {
  if (!terms || terms.length === 0) return null
  if (hideWhenSingle && terms.length === 1) return null

  const sorted = [...terms].sort((a, b) => b.startDate.localeCompare(a.startDate))
  return (
    <div className="field" style={{ flex: '0 0 11rem', marginBottom: 0 }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={termId ?? ''} onChange={(e) => onChange(e.target.value)}>
        {sorted.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}
