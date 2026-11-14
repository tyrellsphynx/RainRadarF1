import { activeSession, isWeekendDone, isWeekendStarted, nextSessionAfter } from '../../domain/sessionWindows'
import type { FeaturedState } from '../../domain/featured'
import { useSchedule } from '../hooks/useSchedule'
import { useTick } from '../hooks/useTick'
import { WeekendForecast } from '../home/WeekendForecast'
import { WeekendHero } from '../shell/WeekendHero'
import { RadarMap } from '../map/RadarMap'

interface TrackPageProps {
  season: number
  round: number
}

/** Full dashboard for one race weekend: sessions + verdicts + radar. */
export default function TrackPage({ season, round }: TrackPageProps) {
  const { weekends, loading, error, reload } = useSchedule()
  const now = useTick(30_000)

  const weekend = weekends.find((w) => w.season === season && w.round === round) ?? null

  if (loading) return <div className="page-loader">Loading the calendar…</div>

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

  if (!weekend) {
    return (
      <div className="error-box">
        <p>
          Unknown round: {season} / {round}.
        </p>
      </div>
    )
  }

  const live = activeSession(weekend, now)
  const state: FeaturedState = live
    ? 'live'
    : isWeekendDone(weekend, now)
      ? 'offseason'
      : isWeekendStarted(weekend, now)
        ? 'weekend'
        : 'next'
  const session = live ?? nextSessionAfter(weekend, now)
  const totalRounds = weekends.filter((w) => w.season === weekend.season).length

  return (
    <>
      <WeekendHero
        weekend={weekend}
        state={state}
        session={session}
        totalRounds={totalRounds}
        showTrackLink={false}
      />

      <WeekendForecast weekend={weekend} live={live} />

      <h2 className="section-title">Rain radar — past 2 hours</h2>
      <RadarMap
        className="track-map"
        lat={weekend.circuit.lat}
        lon={weekend.circuit.lon}
        zoom={11}
        outlineCircuitId={weekend.circuit.circuitId}
      />
      <p className="chart-caption">
        Global radar composites resolve to roughly 1 km per pixel — great for rain bands, soft on
        detail right over the circuit. The forecast cards above are the verdict; the radar is the
        evidence.
      </p>
    </>
  )
}
