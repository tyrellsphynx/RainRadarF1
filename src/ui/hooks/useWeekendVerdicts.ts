import { useMemo } from 'react'
import type { RaceWeekend, SessionVerdict } from '../../domain/types'
import { aggregateWindow } from '../../domain/aggregate'
import { sessionVerdict } from '../../domain/verdict'
import {
  raceShapeFlags,
  tyreCallForWindow,
  tyreTimeline,
  type RaceFlag,
  type TyreCall,
  type TyreTimeline,
} from '../../domain/tyreCall'
import { useForecast } from './useForecast'

export interface SessionTyre {
  call: TyreCall
  timeline: TyreTimeline
  /** Race-shape notes (Race sessions only). */
  flags: RaceFlag[]
}

/** Per-session verdicts + tyre calls for one weekend, plus the hourly series. */
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

  const tyres = useMemo((): SessionTyre[] | null => {
    if (!forecast || !weekend) return null
    return weekend.sessions.map((s) => ({
      call: tyreCallForWindow(forecast.hourly, forecast.minutely15, s.startUtc, s.endUtc),
      timeline: tyreTimeline(forecast.hourly, forecast.minutely15, s.startUtc, s.endUtc),
      flags:
        s.kind === 'Race'
          ? raceShapeFlags(
              weekend.circuit.circuitId,
              forecast.hourly,
              forecast.minutely15,
              s.startUtc,
              s.endUtc,
            )
          : [],
    }))
  }, [forecast, weekend])

  return { forecast, verdicts, tyres, loading, error, reload }
}
