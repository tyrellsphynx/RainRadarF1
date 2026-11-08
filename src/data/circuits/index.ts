import outlinesJson from './track-outlines.json'
import { CIRCUIT_OUTLINE_IDS, type TrackCollection, type TrackLine } from './outlineIds'

export { CIRCUIT_OUTLINE_IDS }
export type { TrackCollection, TrackLine }

/** Bundled track outlines for every circuit on the current calendar. */
export const TRACK_OUTLINES = outlinesJson as unknown as TrackCollection

/** Track outline for a Jolpica circuitId, or null for unmapped circuits. */
export function outlineFor(circuitId: string): TrackLine | null {
  const featureId = CIRCUIT_OUTLINE_IDS[circuitId]
  if (!featureId) return null
  return TRACK_OUTLINES.features.find((f) => f.properties.id === featureId) ?? null
}
