import { VERDICT_META } from '../../domain/verdict'
import type { Verdict } from '../../domain/types'

/** Verdict pill — the app's primary answer, colored by severity. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict]
  return (
    <span className="badge" style={{ background: meta.color }} title={meta.hint}>
      <span className="dot" />
      {meta.label}
    </span>
  )
}
