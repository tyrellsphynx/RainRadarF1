import type { HourlyPoint } from '../../domain/types'
import { formatInTz } from '../../domain/time'

interface PrecipChartProps {
  hourly: HourlyPoint[]
  startMs: number
  endMs: number
  tz: string
}

const HOUR_MS = 3_600_000
const BAR_W = 26
const BAR_GAP = 8
const PAD_L = 8
const PAD_R = 8
const CHART_H = 84
const LABEL_H = 18
const PROB_H = 14

/**
 * Precipitation bar chart across a session window (hourly model data).
 * Bars: mm/h. Dashed band: the session itself. Numbers above bars: rain %.
 */
export function PrecipChart({ hourly, startMs, endMs, tz }: PrecipChartProps) {
  const points = hourly.filter((p) => p.timeUtc + HOUR_MS > startMs - HOUR_MS && p.timeUtc < endMs + HOUR_MS)

  if (points.length === 0) {
    return <p className="chart-caption">No forecast data for this window yet.</p>
  }

  const width = PAD_L + points.length * (BAR_W + BAR_GAP) + PAD_R
  const height = PROB_H + CHART_H + LABEL_H
  const baseY = PROB_H + CHART_H
  const maxMm = Math.max(0.4, ...points.map((p) => p.mm))
  const scale = CHART_H / maxMm
  const stepMs = points.length > 1 ? (points[1]?.timeUtc ?? 0) - (points[0]?.timeUtc ?? 0) : HOUR_MS
  const t0 = points[0]?.timeUtc ?? 0

  const xOf = (timeUtc: number) => PAD_L + ((timeUtc - t0) / stepMs) * (BAR_W + BAR_GAP)
  const bandX = Math.max(PAD_L, xOf(startMs))
  const bandW = Math.max(4, Math.min(width - PAD_R, xOf(endMs)) - bandX)

  return (
    <div className="precip-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Precipitation forecast for this session">
        {/* session window band */}
        <rect x={bandX} y={PROB_H} width={bandW} height={CHART_H} fill="rgba(56,189,248,0.10)" />
        <line x1={bandX} y1={PROB_H} x2={bandX} y2={baseY} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1} />
        <line
          x1={bandX + bandW}
          y1={PROB_H}
          x2={bandX + bandW}
          y2={baseY}
          stroke="#38bdf8"
          strokeDasharray="3 3"
          strokeWidth={1}
        />

        {points.map((p, i) => {
          const h = Math.max(p.mm > 0 ? 2 : 0, p.mm * scale)
          const x = PAD_L + i * (BAR_W + BAR_GAP)
          const fill = p.mm >= 2 ? '#60a5fa' : p.mm >= 0.2 ? '#38bdf8' : '#27496d'
          return (
            <g key={p.timeUtc}>
              <title>{`${formatInTz(p.timeUtc, tz).time} — ${p.mm} mm/h${p.probPct !== null ? ` (${p.probPct}%)` : ''}`}</title>
              {h > 0 && <rect x={x} y={baseY - h} width={BAR_W} height={h} rx={3} fill={fill} />}
              {p.probPct !== null && p.probPct > 0 && (
                <text
                  x={x + BAR_W / 2}
                  y={PROB_H - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#8fa3c4"
                >
                  {p.probPct}
                </text>
              )}
              <text x={x + BAR_W / 2} y={baseY + 13} textAnchor="middle" fontSize={10} fill="#8fa3c4">
                {formatInTz(p.timeUtc, tz).time}
              </text>
            </g>
          )
        })}

        <line x1={PAD_L} y1={baseY} x2={width - PAD_R} y2={baseY} stroke="#22304a" strokeWidth={1} />
        <text x={width - PAD_R} y={PROB_H - 4} textAnchor="end" fontSize={9} fill="#8fa3c4">
          max {maxMm.toFixed(1)} mm/h
        </text>
      </svg>
      <p className="chart-caption">
        Bars: expected mm/h (hover for details) · dashed band: session window · numbers: rain
        probability %. Times shown in your timezone.
      </p>
    </div>
  )
}
