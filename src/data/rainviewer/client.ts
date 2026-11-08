import { JsonCache, isFresh } from '../cache'

/**
 * RainViewer radar tiles. The only free, keyless, global radar tile source.
 * Since 2026-01-01 RainViewer serves past frames only (nowcast was
 * discontinued) — the "next hour" story lives in the Open-Meteo layer.
 */
export const FRAMES_TTL_MS = 5 * 60 * 1000
export const RADAR_TILE_SIZE = 256
/** RainViewer serves radar tiles up to zoom 7 (≈1 km/px). */
export const RADAR_MAX_ZOOM = 7
const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json'
/** Color scheme 2 = Universal Blue (the only scheme left); options 1_1 = smooth + snow. */
const TILE_STYLE = '2/1_1'

export interface RadarFrame {
  /** Frame time, Unix ms. */
  timeUtc: number
  path: string
}

export interface RadarFrames {
  host: string
  past: RadarFrame[]
  fetchedAt: number
}

export interface LoadFramesOptions {
  fetchFn?: typeof fetch
  cache?: JsonCache
  nowMs?: number
  /** Skip the cache read (still writes) — used by the alert poller. */
  force?: boolean
}

/** List of the past-2h radar frames (10-minute steps). */
export async function loadRadarFrames(opts: LoadFramesOptions = {}): Promise<RadarFrames> {
  const fetchFn = opts.fetchFn ?? fetch
  const cache = opts.cache ?? new JsonCache()
  const nowMs = opts.nowMs ?? Date.now()

  const cached = cache.get<RadarFrames>('rrf1:radar-frames')
  if (!opts.force && cached && isFresh(cached, FRAMES_TTL_MS, nowMs)) return cached.value

  const res = await fetchFn(MAPS_URL)
  if (!res.ok) throw new Error(`RainViewer responded ${res.status}`)
  const json = (await res.json()) as {
    host: string
    radar?: { past?: Array<{ time: number; path: string }> }
  }
  const past = (json.radar?.past ?? []).map((f) => ({
    timeUtc: f.time * 1000,
    path: f.path,
  }))
  if (past.length === 0) throw new Error('RainViewer returned no radar frames')

  const frames: RadarFrames = { host: json.host, past, fetchedAt: nowMs }
  cache.set('rrf1:radar-frames', frames)
  return frames
}

/** Raster tile URL template (`{z}/{x}/{y}`) for one radar frame — MapLibre/Leaflet style. */
export function radarTileTemplate(frames: RadarFrames, frame: RadarFrame): string {
  return `${frames.host}${frame.path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${TILE_STYLE}.png`
}

/** Concrete raster tile URL for one radar frame at a slippy-map tile coordinate. */
export function radarTileUrl(
  frames: RadarFrames,
  frame: RadarFrame,
  z: number,
  x: number,
  y: number,
): string {
  return `${frames.host}${frame.path}/${RADAR_TILE_SIZE}/${z}/${x}/${y}/${TILE_STYLE}.png`
}
