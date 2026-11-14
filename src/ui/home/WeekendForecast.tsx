import { tzAt } from '../../domain/time'
import type { RaceWeekend, Session } from '../../domain/types'
import { useStrategyLens } from '../hooks/useStrategyLens'
import { useWeekendVerdicts } from '../hooks/useWeekendVerdicts'
import { StrategyLensToggle } from '../shell/StrategyLensToggle'
import { SessionCard } from './SessionCard'

interface WeekendForecastProps {
  weekend: RaceWeekend
  /** the session happening right now, if any */
  live: Session | null
}

/** "Session-by-session forecast": title row, load/error states and the session cards. */
export function WeekendForecast({ weekend, live }: WeekendForecastProps) {
  const [lensOn] = useStrategyLens()
  const { forecast, verdicts, tyres, loading, error, reload } = useWeekendVerdicts(weekend, lensOn)
  const trackTz = tzAt(weekend.circuit.lat, weekend.circuit.lon)

  return (
    <>
      <div className="section-title-row">
        <h2 className="section-title">Session-by-session forecast</h2>
        <StrategyLensToggle />
      </div>
      {error && (
        <p className="muted">
          Forecast unavailable ({error}){' '}
          <button className="link-btn" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      {loading && !forecast && <p className="muted">Fetching the forecast…</p>}
      <div className="session-list">
        {weekend.sessions.map((session, i) => (
          <SessionCard
            key={session.startUtc}
            session={session}
            trackTz={trackTz}
            verdict={verdicts?.[i] ?? null}
            hourly={forecast?.hourly ?? null}
            tyre={tyres?.[i] ?? null}
            strategyLens={lensOn}
            live={live !== null && session.startUtc === live.startUtc}
          />
        ))}
      </div>
    </>
  )
}
