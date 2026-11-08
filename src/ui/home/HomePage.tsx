import { useMemo } from 'react'
import { featuredWeekend, upcomingWeekends } from '../../domain/featured'
import { formatInTz, tzAt, userTz } from '../../domain/time'
import { useSchedule } from '../hooks/useSchedule'
import { useWeekendVerdicts } from '../hooks/useWeekendVerdicts'
import { useTick } from '../hooks/useTick'
import { SessionCard } from './SessionCard'
import { WeekendHero } from '../shell/WeekendHero'
import { trackHash } from '../shell/useHashRoute'

/**
 * Front door: the next (or live, or just-finished) race weekend answers
 * "will it rain during the sessions?" before anything else.
 */
export default function HomePage() {
  const { weekends, loading, error, reload } = useSchedule()
  const now = useTick(30_000)
  const featured = featuredWeekend(weekends, now)
  const weekend = featured?.weekend ?? null

  const { forecast, verdicts, loading: fcLoading, error: fcError, reload: fcReload } =
    useWeekendVerdicts(weekend)

  const upcoming = useMemo(
    () => upcomingWeekends(weekends, now).filter((w) => w !== weekend),
    [weekends, now, weekend],
  )
  const mine = userTz()
  const trackTz = weekend ? tzAt(weekend.circuit.lat, weekend.circuit.lon) : 'UTC'

  if (loading) {
    return <div className="page-loader">Loading the {new Date().getUTCFullYear()} calendar…</div>
  }

  if (error && weekends.length === 0) {
    return (
      <div className="error-box">
        <p>Could not load the F1 calendar: {error}</p>
        <button className="btn" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }

  if (!featured || !weekend) return <div className="page-loader">No calendar data.</div>

  const liveSession = featured.state === 'live' ? featured.session : null
  const totalRounds = weekends.filter((w) => w.season === weekend.season).length

  return (
    <>
      <WeekendHero
        weekend={weekend}
        state={featured.state}
        session={featured.session}
        totalRounds={totalRounds}
      />

      <h2 className="section-title">Session-by-session forecast</h2>
      {fcError && (
        <p className="muted">
          Forecast unavailable ({fcError}).{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              fcReload()
            }}
          >
            Retry
          </a>
        </p>
      )}
      {fcLoading && !forecast && <p className="muted">Fetching the forecast…</p>}
      <div className="session-list">
        {weekend.sessions.map((session, i) => (
          <SessionCard
            key={session.startUtc}
            session={session}
            trackTz={trackTz}
            verdict={verdicts?.[i] ?? null}
            hourly={forecast?.hourly ?? null}
            live={liveSession !== null && session.startUtc === liveSession.startUtc}
          />
        ))}
      </div>

      {upcoming.length > 0 && (
        <>
          <h2 className="section-title">Coming up</h2>
          <div className="round-list">
            {upcoming.map((w) => (
              <a
                key={`${w.season}-${w.round}`}
                className="round-item"
                href={trackHash(w.season, w.round)}
              >
                <span>
                  <strong>{w.raceName}</strong>{' '}
                  <span className="muted">
                    · {w.circuit.locality}, {w.circuit.country}
                  </span>
                </span>
                <span className="round-when">
                  {formatInTz(w.raceStartUtc, mine).dateLabel} · round {w.round}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </>
  )
}
