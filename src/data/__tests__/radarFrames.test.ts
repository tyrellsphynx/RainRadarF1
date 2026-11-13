import { describe, expect, it } from 'vitest'
import { filterFreshFrames, MAX_FRAME_AGE_MS, type RadarFrame } from '../rainviewer/client'

function frame(ageMs: number, nowMs: number, id: number): RadarFrame {
  return { timeUtc: nowMs - ageMs, path: `/v2/radar/frame${id}` }
}

describe('filterFreshFrames', () => {
  const now = 1_800_000_000_000

  it('keeps frames inside the age window', () => {
    const frames = [frame(0, now, 0), frame(MAX_FRAME_AGE_MS / 2, now, 1)]
    expect(filterFreshFrames(frames, now)).toHaveLength(2)
  })

  it('drops frames older than the window (stale frame lists serve dead tiles)', () => {
    const frames = [
      frame(MAX_FRAME_AGE_MS - 1, now, 0),
      frame(MAX_FRAME_AGE_MS + 1, now, 1),
      frame(2 * MAX_FRAME_AGE_MS, now, 2),
    ]
    const out = filterFreshFrames(frames, now)
    expect(out).toHaveLength(1)
    expect(out[0]?.path).toBe('/v2/radar/frame0')
  })

  it('returns an empty list when every frame is stale', () => {
    const frames = [frame(MAX_FRAME_AGE_MS + 60_000, now, 0)]
    expect(filterFreshFrames(frames, now)).toEqual([])
  })

  it('keeps all frames of a normal 2-hour window', () => {
    const frames = Array.from({ length: 13 }, (_, i) => frame(i * 10 * 60_000, now, i))
    expect(filterFreshFrames(frames, now)).toHaveLength(13)
  })
})
