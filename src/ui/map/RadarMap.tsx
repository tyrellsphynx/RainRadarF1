import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { DARK_STYLE, OPENFREEMAP_ATTRIBUTION } from '../../data/map/darkStyle'
import {
  RADAR_MAX_ZOOM,
  RADAR_TILE_SIZE,
  radarTileTemplate,
  radarTileUrl,
} from '../../data/rainviewer/client'
import { tileAt } from '../../data/rainviewer/proximity'
import { radarTiles } from '../../data/rainviewer/tiles'
import { outlineFor } from '../../data/circuits'
import { formatInTz, userTz } from '../../domain/time'
import { isBackedOff, nextBackoff, type FrameBackoff } from './frameBackoff'
import { ensureRadarProtocol } from './radarProtocol'
import { useRadarFrames } from './useRadarFrames'

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
  /**
   * Start animating right away. Off for views that need many tiles per frame
   * (world map): RainViewer allows ~100 tile requests per minute, so a full
   * loop must be a deliberate, gradual action there.
   */
  autoPlay?: boolean
  className?: string
}

const FADE_MS = 240
const FRAME_INTERVAL_MS = 700
const RADAR_OPACITY = 0.85
/**
 * How long a frame may take to load completely before we keep the previous
 * one. Generous: tile requests queue behind RainViewer's rate budget.
 */
const TILE_LOAD_WAIT_MS = 30_000

/** Resolves true once all tiles of the source's current view have settled; false on timeout or cancel. */
function waitForSourceIdle(
  map: maplibregl.Map,
  id: string,
  timeoutMs: number,
  cancelled: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const poll = () => {
      if (cancelled()) return resolve(false)
      if (map.isSourceLoaded(id)) return resolve(true)
      if (Date.now() >= deadline) return resolve(false)
      window.setTimeout(poll, 100)
    }
    // give MapLibre a moment to notice the new tile URLs and start loading
    window.setTimeout(poll, 150)
  })
}

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
  autoPlay = true,
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
  const frameBackoffRef = useRef(new Map<string, FrameBackoff>())
  const pinClickRef = useRef(onPinClick)
  /** Latest opacity / visibility, readable from long-lived callbacks without re-running playback. */
  const opacityRef = useRef(RADAR_OPACITY)
  const radarOnRef = useRef(true)
  /** A frame is being verified / loaded / faded in — playback waits instead of piling up requests. */
  const busyRef = useRef(false)
  const probeAbortRef = useRef<AbortController | null>(null)
  /** Tile errors per radar layer since its tiles were last switched. */
  const tileErrorsRef = useRef<Record<string, number>>({})
  const showFrameRef = useRef<((index: number) => Promise<void>) | null>(null)

  useEffect(() => {
    pinClickRef.current = onPinClick
  })

  const [mapReady, setMapReady] = useState(false)
  const frames = useRadarFrames(targetIdxRef)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [radarOn, setRadarOn] = useState(true)
  const [opacity, setOpacity] = useState(RADAR_OPACITY)

  // ---- map init (once) ----
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    ensureRadarProtocol()
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

    // Radar tile failures are expected (throttling, outages) and handled per
    // frame by the playback logic; don't let MapLibre spam the console.
    map.on('error', (e) => {
      const sourceId = (e as { sourceId?: string }).sourceId
      if (sourceId === 'radar-a' || sourceId === 'radar-b') {
        if ((e.error as { name?: string } | undefined)?.name !== 'AbortError') {
          tileErrorsRef.current[sourceId] = (tileErrorsRef.current[sourceId] ?? 0) + 1
        }
        return
      }
      console.error(e.error)
    })

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

  // ---- radar opacity / visibility: paint only, never touches playback ----
  useEffect(() => {
    opacityRef.current = opacity
    radarOnRef.current = radarOn
    const map = mapRef.current
    if (!map || !mapReady || map.getSource('radar-a') === undefined) return
    map.setPaintProperty(frontLayerRef.current, 'raster-opacity', radarOn ? opacity : 0)
  }, [mapReady, frames, opacity, radarOn])

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
          tileSize: RADAR_TILE_SIZE,
          maxzoom: RADAR_MAX_ZOOM,
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

    const showFrame = async (index: number) => {
      const frame = frames.past[Math.min(index, frames.past.length - 1)]
      if (!frame) return
      // Monotonic generation: only the latest requested frame may touch the
      // layers; superseded fades and probes abort silently.
      const gen = ++fadeGenRef.current
      const stale = () => gen !== fadeGenRef.current
      probeAbortRef.current?.abort()
      targetIdxRef.current = index
      containerRef.current?.setAttribute('data-requested-frame', frame.path)

      // Failed frames back off (dead path, throttled host, flaky network):
      // skip them entirely — no probe, no tile burst — until their retry time.
      if (isBackedOff(frameBackoffRef.current.get(frame.path), Date.now())) {
        busyRef.current = false
        setFrameIdx(visibleIdxRef.current)
        return
      }

      const frontId = frontLayerRef.current
      const backId = frontId === 'radar-a' ? 'radar-b' : 'radar-a'
      const backSource = map.getSource(backId) as maplibregl.RasterTileSource | undefined
      if (!backSource) {
        busyRef.current = false
        return
      }

      busyRef.current = true
      const probe = new AbortController()
      probeAbortRef.current = probe
      try {
        // Never swap to an unverified layer — that reveals a blank map (the
        // "radar disappears" bug). 1) Probe one tile of the new frame; it
        // lands in the tile cache, so the layer's own request is free.
        const center = map.getCenter()
        const z = Math.min(Math.floor(map.getZoom()), RADAR_MAX_ZOOM)
        const tile = tileAt(center.lat, center.lng, z)
        await radarTiles.fetch(radarTileUrl(frames, frame, tile.z, tile.x, tile.y), {
          signal: probe.signal,
        })
        if (stale()) return

        // 2) Load the whole viewport into the hidden layer. Tile requests
        // queue behind the shared rate budget, so this can take a while.
        map.setPaintProperty(frontId, 'raster-opacity', radarOnRef.current ? opacityRef.current : 0)
        map.setPaintProperty(backId, 'raster-opacity', 0)
        tileErrorsRef.current[backId] = 0
        backSource.setTiles([radarTileTemplate(frames, frame)])
        const loaded = await waitForSourceIdle(map, backId, TILE_LOAD_WAIT_MS, stale)
        if (stale()) return
        if ((tileErrorsRef.current[backId] ?? 0) > 0) throw new Error('radar tiles failed to load')
        if (!loaded) {
          // Still queued behind the budget: not a failure, keep the current frame.
          busyRef.current = false
          setFrameIdx(visibleIdxRef.current)
          return
        }

        // 3) Only now crossfade.
        frameBackoffRef.current.delete(frame.path)
        setFrameIdx(index)
        const start = performance.now()
        const tick = (t: number) => {
          if (stale()) return
          // rAF timestamps can predate `start` — clamp into [0, 1]
          const k = Math.max(0, Math.min(1, (t - start) / FADE_MS))
          const target = radarOnRef.current ? opacityRef.current : 0
          map.setPaintProperty(backId, 'raster-opacity', k * target)
          map.setPaintProperty(frontId, 'raster-opacity', (1 - k) * target)
          if (k < 1) {
            requestAnimationFrame(tick)
          } else {
            map.setPaintProperty(backId, 'raster-opacity', radarOnRef.current ? opacityRef.current : 0)
            map.setPaintProperty(frontId, 'raster-opacity', 0)
            frontLayerRef.current = backId
            visibleIdxRef.current = index
            busyRef.current = false
            containerRef.current?.setAttribute('data-visible-frame', frame.path)
          }
        }
        requestAnimationFrame(tick)
      } catch {
        if (stale()) return
        frameBackoffRef.current.set(
          frame.path,
          nextBackoff(frameBackoffRef.current.get(frame.path), Date.now()),
        )
        busyRef.current = false
        setFrameIdx(visibleIdxRef.current)
      }
    }
    showFrameRef.current = showFrame

    // paint the current frame immediately (mount / scrub / new frames)
    void showFrame(targetIdxRef.current)

    const stop = () => {
      // Bumping the live refs is intentional: it cancels in-flight fades and probes.
      fadeGenRef.current++
      probeAbortRef.current?.abort()
      busyRef.current = false
    }

    if (!playing || !radarOn) return stop

    // Advance only when the previous frame is done: playback runs at the pace
    // the tiles arrive, instead of queueing a request burst per tick.
    const id = window.setInterval(() => {
      if (busyRef.current) return
      void showFrame((targetIdxRef.current + 1) % frames.past.length)
    }, FRAME_INTERVAL_MS)
    return () => {
      stop()
      window.clearInterval(id)
    }
  }, [mapReady, frames, playing, radarOn])

  const scrubTo = (index: number) => {
    setPlaying(false)
    setFrameIdx(index) // optimistic; reverts to the visible frame on failure
    void showFrameRef.current?.(index)
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
              aria-label={playing ? 'Pause radar' : 'Play radar'}
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
              aria-valuetext={currentFrame ? formatInTz(currentFrame.timeUtc, mine).time : undefined}
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
