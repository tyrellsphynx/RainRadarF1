import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { DARK_STYLE, OPENFREEMAP_ATTRIBUTION } from '../../data/map/darkStyle'
import {
  loadRadarFrames,
  radarTileTemplate,
  type RadarFrames,
} from '../../data/rainviewer/client'
import { outlineFor } from '../../data/circuits'
import { formatInTz, userTz } from '../../domain/time'

export interface PinSpec {
  id: string
  lon: number
  lat: number
  color: string
  title: string
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
  const frameIdxRef = useRef(0)
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

  // ---- radar frame list ----
  useEffect(() => {
    let alive = true
    loadRadarFrames()
      .then((f) => {
        if (!alive) return
        frameIdxRef.current = f.past.length - 1
        setFrames(f)
        setFrameIdx(f.past.length - 1)
      })
      .catch(() => setFrames(null))
    return () => {
      alive = false
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
      const frame = frames.past[index]
      if (!frame) return
      const frontId = frontLayerRef.current
      const backId = frontId === 'radar-a' ? 'radar-b' : 'radar-a'
      const backSource = map.getSource(backId) as maplibregl.RasterTileSource | undefined
      if (!backSource) return
      backSource.setTiles([radarTileTemplate(frames, frame)])

      const start = performance.now()
      const tick = (t: number) => {
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
        }
      }
      requestAnimationFrame(tick)
    }
    showFrameRef.current = showFrame

    // paint the current frame immediately (mount / scrub / new frames)
    showFrame(frameIdxRef.current)

    if (!playing || !radarOn) return
    const id = window.setInterval(() => {
      const next = (frameIdxRef.current + 1) % frames.past.length
      frameIdxRef.current = next
      setFrameIdx(next)
      showFrame(next)
    }, FRAME_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [mapReady, frames, playing, radarOn, opacity])

  const scrubTo = (index: number) => {
    frameIdxRef.current = index
    setFrameIdx(index)
    setPlaying(false)
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
          <div className="muted" style={{ fontSize: 11 }}>
            past 2 h · 10-min steps · forecast lives in the session cards
          </div>
        </div>
      )}
    </div>
  )
}
