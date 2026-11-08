import { useState } from 'react'
import type { HourlyPoint, Session, SessionVerdict, SessionKind } from '../../domain/types'
import { formatInTz, userTz } from '../../domain/time'
import { PrecipChart } from '../charts/PrecipChart'
import { VerdictBadge } from '../shell/VerdictBadge'

export const SESSION_LABELS: Record<SessionKind, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SprintQualifying: 'Sprint Qualifying',
  Sprint: 'Sprint',
  Qualifying: 'Qualifying',
  Race: 'Race',
}

interface SessionCardProps {
  session: Session
  trackTz: string
  /** null while the forecast is loading or unavailable */
  verdict: SessionVerdict | null
  hourly: HourlyPoint[] | null
  live?: boolean
}

/** One session row: verdict badge + dual timezones, expandable chart. */
export function SessionCard({ session, trackTz, verdict, hourly, live = false }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const mine = userTz()
  const userTime = formatInTz(session.startUtc, mine)
  const trackTime = formatInTz(session.startUtc, trackTz)

  return (
    <div className={`session-card${live ? ' live' : ''}`}>
      <button
        className="session-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="session-kind">
          {SESSION_LABELS[session.kind]}
          <small>{live ? 'in progress' : expanded ? 'hide chart' : 'show chart'}</small>
        </span>

        <span className="session-times">
          <strong>
            {userTime.dateLabel}, {userTime.time}
          </strong>
          <small>
            {trackTime.time} at the track ({trackTime.dateLabel})
          </small>
        </span>

        <VerdictBadge verdict={verdict?.verdict ?? 'unknown'} />

        <span className="session-numbers">
          <span>
            rain <strong>{verdict?.probPct != null ? `${verdict.probPct}%` : '—'}</strong>
          </span>
          <span>
            total <strong>{verdict ? `${verdict.mm} mm` : '—'}</strong>
          </span>
        </span>
      </button>

      {expanded && (
        <div className="session-chart">
          {hourly ? (
            <PrecipChart hourly={hourly} startMs={session.startUtc} endMs={session.endUtc} tz={mine} />
          ) : (
            <p className="chart-caption">Forecast unavailable — check your connection.</p>
          )}
        </div>
      )}
    </div>
  )
}
