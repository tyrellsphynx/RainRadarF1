import { useStrategyLens } from '../hooks/useStrategyLens'

/** Turns the tyre-call overlay on/off (persisted preference). */
export function StrategyLensToggle() {
  const [on, toggle] = useStrategyLens()
  return (
    <button
      className={`lens-toggle${on ? ' on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      title="Translate the forecast into tyre calls (Slicks / Inters / Wets) with confidence"
    >
      <span className="lens-knob" />
      Strategy lens
    </button>
  )
}
