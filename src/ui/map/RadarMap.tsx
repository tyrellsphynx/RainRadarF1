import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { DARK_STYLE, OPENFREEMAP_ATTRIBUTION } from '../../data/map/darkStyle'
import {
  FRAMES_TTL_MS,
  loadRadarFrames,
  RADAR_MAX_ZOOM,
  radarTileTemplate,
  radarTileUrl,
  type RadarFrames,
} from '../../data/rainviewer/client'
import { tileAt } from '../../data/rainviewer/proximity'
import { outlineFor } from '../../data/circuits'
import { formatInTz, userTz } from '../../domain/time'

export interface PinSpec {
  id: string
  lon: number
  lat: number
  color: string
  title: string
  /** Verdict label for screen readers (keyboard-accessible list). */
  status?: string
}

interface RadarMapProps {
  lat: number
  lon: number
  zoom?: number
  /** Jolpica circuitId — draws the track outline when known */
  outlineCircuitId?: string | null
  pins?: PinSpec[]
  onPinClick?: (id: string) => void
  fitBoundsToPins?: boolean
  showRadarControls?: boolean
  className?: string
}

const FADE_MS = 240
const FRAME_INTERVAL_MS = 700
const RADAR_OPACITY = 0.85
/** How long to wait for a frame's tiles before giving up and keeping the previous frame. */
const TILE_WAIT_MS = 8000
/** Failed-frame retry backoff: base delay and cap. */
const BACKOFF_BASE_MS = 15_000
const BACKOFF_MAX_MS = 120_000

function pinsToGeoJSON(pins: PinSpec[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, title: p.title, color: p.color },
    })),
  }
}

/**
 * MapLibre map with the animated RainViewer radar layer (past 2 h),
 * optional track outline and status pins, and playback controls.
 */
export function RadarMap({
  lat,
  lon,
  zoom = 5,
  outlineCircuitId = null,
  pins = [],
  onPinClick,
  fitBoundsToPins = false,
  showRadarControls = true,
  className = 'map-container',
}: RadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const frontLayerRef = useRef<'radar-a' | 'radar-b'>('radar-a')
  /** Bumped per requested frame (and per effect cleanup) to cancel stale fades. */
  const fadeGenRef = useRef(0)
  /** Playback position (what we try to show next). */
  const targetIdxRef = useRef(0)
  /** Last frame actually rendered — the truth the UI reverts to. */
  const visibleIdxRef = useRef(0)
  /** Per-frame retry backoff after failed tile fetches. */
  const frameBackoffRef = useRef(new Map<string, { fails: number; retryAt: number }>())
  const pinClickRef = useRef(onPinClick)
  const showFrameRef = useRef<((index: number) => void) | null>(null)

  useEffect(() => {
    pinClickRef.current = onPinClick
  })

  const [mapReady, setMapReady] = useState(false)
  const [frames, setFrames] = useState<RadarFrames | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [radarOn, setRadarOn] = useState(true)
  const [opacity, setOpacity] = useState(RADAR_OPACITY)

  // ---- map init (once) ----
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const map = new maplibregl.Map({
      container,
      style: DARK_STYLE,
      center: [lon, lat],
      zoom,
      attributionControl: {
        compact: true,
        customAttribution: `Radar © <a href="https://www.rainviewer.com/">RainViewer</a> · ${OPENFREEMAP_ATTRIBUTION}`,
      },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      const outline = outlineCircuitId ? outlineFor(outlineCircuitId) : null
      if (outline) {
        map.addSource('track-outline', {
          type: 'geojson',
          data: outline as unknown as Feature,
        })
        map.addLayer({
          id: 'track-outline-glow',
          type: 'line',
          source: 'track-outline',
          paint: { 'line-color': '#38bdf8', 'line-width': 8, 'line-opacity': 0.25 },
        })
        map.addLayer({
          id: 'track-outline',
          type: 'line',
          source: 'track-outline',
          paint: { 'line-color': '#7dd3fc', 'line-width': 2.5 },
        })

        // Frame the circuit nicely instead of a fixed zoom level.
        const bounds = new maplibregl.LngLatBounds()
        for (const [x, y] of outline.geometry.coordinates) bounds.extend([x, y])
        map.fitBounds(bounds, {
          padding: { top: 90, bottom: 40, left: 40, right: 40 },
          maxZoom: 14,
          duration: 0,
        })
      }

      if (pins.length > 0) {
        map.addSource('pins', {
          type: 'geojson',
          data: pinsToGeoJSON(pins),
        })
        map.addLayer({
          id: 'pins-circle',
          type: 'circle',
          source: 'pins',
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 5, 9, 10, 11],
            'circle-stroke-color': '#0b1220',
            'circle-stroke-width': 2,
          },
        })
        map.addLayer({
          id: 'pins-label',
          type: 'symbol',
          source: 'pins',
          minzoom: 3,
          layout: {
            'text-field': ['get', 'title'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 1.1],
            'text-allow-overlap': false,
          },
          paint: { 'text-color': '#c7d5ea', 'text-halo-color': '#0b1220', 'text-halo-width': 1.4 },
        })

        map.on('click', 'pins-circle', (e: maplibregl.MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          if (typeof id === 'string') pinClickRef.current?.(id)
        })
        map.on('mouseenter', 'pins-circle', () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', 'pins-circle', () => (map.getCanvas().style.cursor = ''))

        if (fitBoundsToPins) {
          const bounds = new maplibregl.LngLatBounds()
          for (const p of pins) bounds.extend([p.lon, p.lat])
          map.fitBounds(bounds, { padding: 60, maxZoom: 5, duration: 0 })
        }
      }

      setMapReady(true)
    })

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
    // init once; pins/outline are static per page instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- keep pin colors in sync (status data arrives after mount) ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('pins') as maplibregl.GeoJSONSource | undefined
    if (source && pins.length > 0) source.setData(pinsToGeoJSON(pins))
  }, [mapReady, pins])

  // ---- radar frame list (refreshed while mounted: the window slides) ----
  useEffect(() => {
    let alive = true
    const load = (first: boolean) =>
      loadRadarFrames()
        .then((f) => {
          if (!alive || f.past.length === 0) return
          // First load starts at the newest frame; refreshes keep their place.
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
  }, [])

  // ---- radar layers + playback (needs both map and frames) ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !frames || frames.past.length === 0) return

    if (map.getSource('radar-a') === undefined) {
      const first = frames.past[frames.past.length - 1]
      const beforeId = map.getLayer('pins-circle')
        ? 'pins-circle'
        : map.getLayer('track-outline-glow')
          ? 'track-outline-glow'
          : undefined
      for (const id of ['radar-a', 'radar-b'] as const) {
        map.addSource(id, {
          type: 'raster',
          tiles: [first ? radarTileTemplate(frames, first) : ''],
          tileSize: 256,
          maxzoom: 7,
        })
        map.addLayer(
          {
            id,
            type: 'raster',
            source: id,
            paint: {
              'raster-opacity': id === frontLayerRef.current ? RADAR_OPACITY : 0,
              'raster-fade-duration': 0,
            },
          },
          beforeId,
        )
      }
    }

    const showFrame = (index: number) => {
      const frame = frames.past[Math.min(index, frames.past.length - 1)]
      if (!frame) return
      // Monotonic generation: only the latest requested frame may touch the
      // layers; superseded fades and probes abort silently.
      const gen = ++fadeGenRef.current
      targetIdxRef.current = index
      containerRef.current?.setAttribute('data-requested-frame', frame.path)

      // Failed frames back off (dead path, throttled host, flaky network):
      // skip them entirely — no probe, no tile burst — until their retry time.
      const backoff = frameBackoffRef.current.get(frame.path)
      if (backoff && Date.now() < backoff.retryAt) {
        if (gen === fadeGenRef.current) setFrameIdx(visibleIdxRef.current)
        return
      }

      const frontId = frontLayerRef.current
      const backId = frontId === 'radar-a' ? 'radar-b' : 'radar-a'
      const backSource = map.getSource(backId) as maplibregl.RasterTileSource | undefined
      if (!backSource) return

      // Never swap to an unverified layer — that reveals a blank map (the
      // "radar disappears" bug). Probe one tile of the new frame first; only
      // swap once tiles demonstrably fetch. On failure the map keeps showing
      // the last good frame and the frame is retried later with backoff.
      const verified = () => {
        if (gen !== fadeGenRef.current) return
        frameBackoffRef.current.delete(frame.path)
        setFrameIdx(index)
        // Snap to "current frame visible, incoming hidden", then crossfade.
        map.setPaintProperty(frontId, 'raster-opacity', radarOn ? opacity : 0)
        map.setPaintProperty(backId, 'raster-opacity', 0)
        backSource.setTiles([radarTileTemplate(frames, frame)])
        const start = performance.now()
        const tick = (t: number) => {
          if (gen !== fadeGenRef.current) return
          // rAF timestamps can predate `start` — clamp into [0, 1]
          const k = Math.max(0, Math.min(1, (t - start) / FADE_MS))
          map.setPaintProperty(backId, 'raster-opacity', k * opacity)
          map.setPaintProperty(frontId, 'raster-opacity', (1 - k) * opacity)
          if (k < 1) {
            requestAnimationFrame(tick)
          } else {
            map.setPaintProperty(backId, 'raster-opacity', radarOn ? opacity : 0)
            map.setPaintProperty(frontId, 'raster-opacity', 0)
            frontLayerRef.current = backId
            visibleIdxRef.current = index
            containerRef.current?.setAttribute('data-visible-frame', frame.path)
          }
        }
        requestAnimationFrame(tick)
      }
      const failed = () => {
        const prev = frameBackoffRef.current.get(frame.path)
        const fails = (prev?.fails ?? 0) + 1
        frameBackoffRef.current.set(frame.path, {
          fails,
          retryAt: Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS),
        })
        if (gen === fadeGenRef.current) setFrameIdx(visibleIdxRef.current)
      }

      const center = map.getCenter()
      const z = Math.min(Math.floor(map.getZoom()), RADAR_MAX_ZOOM)
      const tile = tileAt(center.lat, center.lng, z)
      const probe = new AbortController()
      const probeTimer = window.setTimeout(() => probe.abort(), TILE_WAIT_MS)
      fetch(radarTileUrl(frames, frame, tile.z, tile.x, tile.y), { signal: probe.signal })
        .then((res) => {
          window.clearTimeout(probeTimer)
          if (res.ok) verified()
          else failed()
        })
        .catch(() => {
          window.clearTimeout(probeTimer)
          failed()
        })
    }
    showFrameRef.current = showFrame

    // paint the current frame immediately (mount / scrub / new frames)
    showFrame(targetIdxRef.current)

    if (!playing || !radarOn) {
      return () => {
        fadeGenRef.current++ // cancel any in-flight fade
      }
    }
    const id = window.setInterval(() => {
      showFrame((targetIdxRef.current + 1) % frames.past.length)
    }, FRAME_INTERVAL_MS)
    return () => {
      // Bumping the live ref is intentional: it cancels in-flight fades.
      fadeGenRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      window.clearInterval(id)
    }
  }, [mapReady, frames, playing, radarOn, opacity])

  const scrubTo = (index: number) => {
    setPlaying(false)
    setFrameIdx(index) // optimistic; reverts to the visible frame on failure
    showFrameRef.current?.(index)
  }

  const currentFrame = frames?.past[frameIdx]
  const mine = userTz()

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {showRadarControls && frames && (
        <div className="radar-controls">
          <div className="row">
            <button
              className="icon-btn"
              onClick={() => setPlaying((p) => !p)}
              title={playing ? 'Pause radar' : 'Play radar'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.past.length - 1)}
              value={frameIdx}
              onChange={(e) => scrubTo(Number(e.target.value))}
              aria-label="Radar frame"
            />
            <span className="frame-time">
              {currentFrame ? formatInTz(currentFrame.timeUtc, mine).time : '—'}
            </span>
          </div>
          <div className="row">
            <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={radarOn} onChange={(e) => setRadarOn(e.target.checked)} />
              Radar
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="Radar opacity"
            />
          </div>
        </div>
      )}
    </div>
  )
}
