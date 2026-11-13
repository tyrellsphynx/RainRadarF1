import type { HourlyPoint } from '../../domain/types'
import { formatInTz } from '../../domain/time'
import { COMPOUND_META, type TyreStep, type TyreTimeline } from '../../domain/tyreCall'

interface PrecipChartProps {
  hourly: HourlyPoint[]
  startMs: number
  endMs: number
  tz: string
  /** strategy lens: per-step tyre calls to draw as compound bands */
  timeline?: TyreTimeline | null
}

const HOUR_MS = 3_600_000

/**
 * Precipitation bar chart across a session window (hourly model data).
 * Bars: mm/h. Shaded band: the session itself. Numbers above bars: rain %.
 * With a tyre timeline: compound color bands + crossover annotations.
 * DOM-based (not SVG) so it fills any card width with crisp labels.
 */
export function PrecipChart({ hourly, startMs, endMs, tz, timeline = null }: PrecipChartProps) {
  const points = hourly.filter(
    (p) => p.timeUtc + HOUR_MS > startMs - HOUR_MS && p.timeUtc < endMs + HOUR_MS,
  )

  if (points.length === 0) {
    return <p className="chart-caption">No forecast data for this window yet.</p>
  }

  const t0 = points[0]?.timeUtc ?? 0
  const stepMs =
    points.length > 1 ? (points[1]?.timeUtc ?? 0) - (points[0]?.timeUtc ?? 0) : HOUR_MS
  const spanMs = points.length * stepMs
  const pctOf = (timeUtc: number) =>
    Math.max(0, Math.min(100, ((timeUtc - t0) / spanMs) * 100))

  const bandLeft = pctOf(startMs)
  const bandRight = pctOf(endMs)
  const maxMm = Math.max(0.4, ...points.map((p) => p.mm))
  const totalMm = points.reduce((sum, p) => sum + p.mm, 0)
  const chartLabel =
    `Precipitation forecast chart: ${points.length} hourly steps, ` +
    `peak ${maxMm.toFixed(1)} mm per hour, about ${Math.round(totalMm * 10) / 10} mm expected in total. ` +
    'Rain probability per hour is shown above each bar; the shaded band marks the session window.'

  // compound bands (strategy lens) — clipped to the session window
  const segments: Array<{ left: number; width: number; color: string }> = []
  if (timeline) {
    for (const step of timeline.steps) {
      const s = Math.max(step.timeUtc, startMs)
      const e = Math.min(step.timeUtc + step.stepMs, endMs)
      if (e <= s) continue
      const left = pctOf(s)
      const width = pctOf(e) - left
      if (width > 0) segments.push({ left, width, color: COMPOUND_META[step.compound].color })
    }
  }

  return (
    <div className="precip-chart">
      <div className="precip-plot" role="img" aria-label={chartLabel}>
        <div
          className="precip-band"
          style={{ left: `${bandLeft}%`, width: `${Math.max(1, bandRight - bandLeft)}%` }}
        />

        {segments.map((seg, i) => (
          <div
            key={i}
            className="precip-seg"
            style={{ left: `${seg.left}%`, width: `${seg.width}%`, background: seg.color }}
          />
        ))}

        {timeline?.crossovers.map((c) => {
          const x = pctOf(c.timeUtc)
          if (x < bandLeft - 1 || x > bandRight + 1) return null
          return (
            <div key={c.timeUtc} className="precip-crossover" style={{ left: `${x}%` }}>
              <span
                className="precip-crossover-label"
                style={{ color: COMPOUND_META[c.to].color }}
              >
                → {COMPOUND_META[c.to].label} ~{c.minute}′
              </span>
            </div>
          )
        })}

        <div className="precip-bars">
          {points.map((p) => (
            <div className="precip-slot" key={p.timeUtc}>
              <span className="precip-prob">{p.probPct !== null && p.probPct > 0 ? p.probPct : ''}</span>
              <div className="precip-bar-wrap">
                {p.mm > 0 && (
                  <div
                    className="precip-bar"
                    style={{
                      height: `${Math.max(4, (p.mm / maxMm) * 100)}%`,
                      background: p.mm >= 2 ? '#60a5fa' : p.mm >= 0.2 ? '#38bdf8' : '#27496d',
                    }}
                    title={`${formatInTz(p.timeUtc, tz).time} — ${p.mm} mm/h${p.probPct !== null ? ` (${p.probPct}%)` : ''}`}
                  />
                )}
              </div>
              <span className="precip-time">{formatInTz(p.timeUtc, tz).time}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="chart-caption">
        Bars: expected mm/h (hover for details) · shaded band: session window · numbers: rain
        probability %. Times shown in your timezone.
      </p>
      {timeline && timeline.steps.length > 0 && (
        <p className="chart-caption tyre-caption">Tyre lens: {tyreCaption(timeline)}</p>
      )}
    </div>
  )
}

function tyreCaption(timeline: TyreTimeline): string {
  const label = (c: TyreStep['compound']) => COMPOUND_META[c].label
  if (timeline.crossovers.length > 0) {
    return timeline.crossovers
      .map((c) => `${label(c.from)} → ${label(c.to)} ~min ${c.minute}`)
      .join(' · ')
  }
  const first = timeline.steps[0]
  return first ? `${label(first.compound)} throughout` : '—'
}
