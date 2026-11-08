import { RADAR_MAX_ZOOM, RADAR_TILE_SIZE } from './client'

export interface TileCoord {
  z: number
  x: number
  y: number
  /** pixel position inside the tile */
  px: number
  py: number
}

/** Slippy-map tile + pixel containing a coordinate at zoom z. */
export function tileAt(lat: number, lon: number, z: number): TileCoord {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const yNorm = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
  const y = Math.floor(yNorm * n)
  return {
    z,
    x: clampTile(x, n),
    y: clampTile(y, n),
    px: Math.floor((((lon + 180) / 360) * n - x) * RADAR_TILE_SIZE),
    py: Math.floor((yNorm * n - y) * RADAR_TILE_SIZE),
  }
}

/** Ground resolution (km/px) at a latitude and zoom (Mercator, local scale). */
export function kmPerPx(lat: number, z: number): number {
  const n = 2 ** z
  const pxPerDeg = (n * RADAR_TILE_SIZE) / 360
  return (111.32 * Math.cos((lat * Math.PI) / 180)) / pxPerDeg
}

/**
 * Fraction of the radar tile pixels with precipitation inside a radius of the
 * circuit (0..1). Approximate by design: samples the single z7 tile containing
 * the circuit — a 25 km radius fits inside one tile (~280 km wide) except near
 * tile edges, which is acceptable for an alert heuristic.
 */
export async function radarCoverageNear(
  tileUrl: string,
  lat: number,
  lon: number,
  radiusKm = 25,
): Promise<number> {
  try {
    const tile = tileAt(lat, lon, RADAR_MAX_ZOOM)
    const image = await loadImage(tileUrl)
    const canvas = document.createElement('canvas')
    canvas.width = RADAR_TILE_SIZE
    canvas.height = RADAR_TILE_SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 0
    ctx.drawImage(image, 0, 0)

    const pxR = Math.min(radiusKm / kmPerPx(lat, RADAR_MAX_ZOOM), RADAR_TILE_SIZE / 2)
    const x0 = Math.max(0, Math.floor(tile.px - pxR))
    const x1 = Math.min(RADAR_TILE_SIZE, Math.ceil(tile.px + pxR))
    const y0 = Math.max(0, Math.floor(tile.py - pxR))
    const y1 = Math.min(RADAR_TILE_SIZE, Math.ceil(tile.py + pxR))
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data

    let wet = 0
    let total = 0
    const width = x1 - x0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - tile.px
        const dy = y - tile.py
        if (dx * dx + dy * dy > pxR * pxR) continue
        total++
        const alpha = data[((y - y0) * width + (x - x0)) * 4 + 3]
        if (alpha !== undefined && alpha > 20) wet++
      }
    }
    return total === 0 ? 0 : wet / total
  } catch {
    return 0 // tile fetch failed — no evidence of rain, no alert
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load radar tile: ${url}`))
    img.src = url
  })
}

function clampTile(v: number, n: number): number {
  return Math.max(0, Math.min(n - 1, v))
}
