import { useEffect, useState, type MutableRefObject } from 'react'
import { FRAMES_TTL_MS, loadRadarFrames, type RadarFrames } from '../../data/rainviewer/client'

/**
 * Radar frame list, refreshed while mounted (the 2 h window slides).
 * The first load starts playback at the newest frame; refreshes keep their
 * place — `targetIdxRef` is the shared playback position.
 */
export function useRadarFrames(targetIdxRef: MutableRefObject<number>): RadarFrames | null {
  const [frames, setFrames] = useState<RadarFrames | null>(null)

  useEffect(() => {
    let alive = true
    const load = (first: boolean) =>
      loadRadarFrames()
        .then((f) => {
          if (!alive || f.past.length === 0) return
          const idx = first ? f.past.length - 1 : Math.min(targetIdxRef.current, f.past.length - 1)
          targetIdxRef.current = idx
          setFrames(f)
        })
        .catch(() => {
          if (first) setFrames(null)
        })
    load(true)
    const id = window.setInterval(() => load(false), FRAMES_TTL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [targetIdxRef])

  return frames
}
