import { countdownParts, formatCountdown } from '../../domain/time'
import { useTick } from '../hooks/useTick'

/** Live countdown ("3d 04h 12m"), ticks on its own. */
export function Countdown({ targetMs }: { targetMs: number }) {
  const now = useTick(1000)
  return <span className="countdown">{formatCountdown(countdownParts(targetMs, now))}</span>
}
