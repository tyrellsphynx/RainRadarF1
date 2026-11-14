import { JsonCache, isFresh } from '../cache'

/**
 * RainViewer radar tiles. The only free, keyless, global radar tile source.
 * Since 2026-01-01 RainViewer serves past frames only (nowcast was
 * discontinued) — the "next hour" story lives in the Open-Meteo layer.
 */
export const FRAMES_TTL_MS = 5 * 60 * 1000
/**
 * 512 px tiles: a 512 px tile at zoom z covers the same area as the 256 px tile
 * at z, and MapLibre asks for one zoom level lower with `tileSize: 512` — about
 * a quarter of the requests for the same view. That matters under RainViewer's
 * 100 requests/minute limit.
 */
export const RADAR_TILE_SIZE = 512
/** RainViewer serves radar tiles up to zoom 7. */
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
  const past = filterFreshFrames(
    (json.radar?.past ?? []).map((f) => ({
      timeUtc: f.time * 1000,
      path: f.path,
    })),
    nowMs,
  )
  if (past.length === 0) throw new Error('RainViewer returned no fresh radar frames')

  const frames: RadarFrames = { host: json.host, past, fetchedAt: nowMs }
  cache.set('rrf1:radar-frames', frames)
  return frames
}

/** Frames older than this are dropped: their tiles may no longer be served. */
export const MAX_FRAME_AGE_MS = 3 * 60 * 60 * 1000

/**
 * Keep only frames a viewer could plausibly still see: a stale frame list
 * (cached weather-maps.json) references tile paths that can die server-side,
 * which renders as a blank radar. The live window is 2 h; 3 h is slack.
 */
export function filterFreshFrames(frames: RadarFrame[], nowMs: number): RadarFrame[] {
  const cutoff = nowMs - MAX_FRAME_AGE_MS
  return frames.filter((f) => f.timeUtc >= cutoff)
}

/**
 * Custom URL scheme per raster layer, so MapLibre radar tiles pass the
 * rate-limit budget (see tileScheduler.ts) instead of hitting the network
 * directly — and the protocol handler can tell the visible layer's tiles
 * from the animation's preload tiles.
 */
export type RadarLayerId = 'radar-a' | 'radar-b'
export const radarProtocolSchemes: Record<RadarLayerId, string> = {
  'radar-a': 'rvtile-a',
  'radar-b': 'rvtile-b',
}

/** `https://host/path` → the layer's budgeted scheme (`rvtile-a://host/path`). */
export function toRadarProtocolUrl(httpsUrl: string, layer: RadarLayerId): string {
  return httpsUrl.replace(/^https:/, `${radarProtocolSchemes[layer]}:`)
}

/** `rvtile-a://host/path` → `https://host/path` (the cache key shared by both layers). */
export function fromRadarProtocolUrl(url: string): string {
  return url.replace(/^rvtile-[ab]:/, 'https:')
}

/** MapLibre raster tile URL template (`{z}/{x}/{y}`) for one radar frame, in the layer's budgeted scheme. */
export function radarTileTemplate(
  frames: RadarFrames,
  frame: RadarFrame,
  layer: RadarLayerId,
): string {
  return toRadarProtocolUrl(
    `${frames.host}${frame.path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${TILE_STYLE}.png`,
    layer,
  )
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
