import type { FeaturedState } from '../../domain/featured'
import type { RaceWeekend, Session } from '../../domain/types'
import { SESSION_LABELS } from '../home/SessionCard'
import { Countdown } from './Countdown'
import { trackHash } from './useHashRoute'

interface WeekendHeroProps {
  weekend: RaceWeekend
  state: FeaturedState
  session: Session | null
  totalRounds: number
  /** hide the "track dashboard" link when already on that page */
  showTrackLink?: boolean
}

const STATE_CHIPS: Record<FeaturedState, string> = {
  live: 'Live now',
  weekend: 'Race weekend',
  next: 'Next up',
  offseason: 'Season complete',
}

export function WeekendHero({
  weekend,
  state,
  session,
  totalRounds,
  showTrackLink = true,
}: WeekendHeroProps) {
  return (
    <section className="hero">
      <div className="hero-eyebrow">
        <span>
          Round {weekend.round} of {totalRounds} · {weekend.season}
        </span>
        <span className={`chip${state === 'live' ? ' live' : ''}`}>{STATE_CHIPS[state]}</span>
      </div>

      <h1>{weekend.raceName}</h1>
      <p className="hero-sub">
        {weekend.circuit.circuitName} · {weekend.circuit.locality}, {weekend.circuit.country}
      </p>

      <div className="hero-clock">
        {session ? (
          <>
            <span className="label">
              {SESSION_LABELS[session.kind]} {state === 'live' ? '— ends in' : '— starts in'}
            </span>
            <Countdown targetMs={state === 'live' ? session.endUtc : session.startUtc} />
          </>
        ) : (
          <span className="label">That&apos;s a wrap for this season — see you at the next one.</span>
        )}
      </div>

      <div className="hero-links">
        {showTrackLink && (
          <a className="btn primary" href={trackHash(weekend.season, weekend.round)}>
            Full track dashboard →
          </a>
        )}
        <a className="btn" href="#/map">
          Rain map →
        </a>
      </div>
    </section>
  )
}
