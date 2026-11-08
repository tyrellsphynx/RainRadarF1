import { useMemo } from 'react'
import type { RaceWeekend, SessionVerdict } from '../../domain/types'
import { aggregateWindow } from '../../domain/aggregate'
import { sessionVerdict } from '../../domain/verdict'
import { useForecast } from './useForecast'

/** Per-session verdicts for one weekend, plus the raw hourly series. */
export function useWeekendVerdicts(weekend: RaceWeekend | null) {
  const { forecast, loading, error, reload } = useForecast(
    weekend ? weekend.circuit.lat : null,
    weekend ? weekend.circuit.lon : null,
  )

  const verdicts = useMemo((): SessionVerdict[] | null => {
    if (!forecast || !weekend) return null
    return weekend.sessions.map((s) =>
      sessionVerdict(aggregateWindow(forecast.hourly, s.startUtc, s.endUtc)),
    )
  }, [forecast, weekend])

  return { forecast, verdicts, loading, error, reload }
}
