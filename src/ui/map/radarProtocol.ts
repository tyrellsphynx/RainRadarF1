import * as maplibregl from 'maplibre-gl'
import {
  fromRadarProtocolUrl,
  radarProtocolSchemes,
  type RadarLayerId,
} from '../../data/rainviewer/client'
import { radarTiles } from '../../data/rainviewer/tiles'

let registered = false
let frontLayer: RadarLayerId | null = null

/**
 * Which radar layer is currently visible. Its tiles win the request queue
 * over the animation's preload tiles, so the map stays responsive while the
 * loop keeps playing behind it.
 */
export function setFrontRadarLayer(layer: RadarLayerId | null): void {
  frontLayer = layer
}

/**
 * Route `rvtile-a://` / `rvtile-b://` tile requests from MapLibre through the
 * shared request budget, prioritising the visible layer.
 */
export function ensureRadarProtocol(): void {
  if (registered) return
  registered = true
  for (const [layer, scheme] of Object.entries(radarProtocolSchemes)) {
    maplibregl.addProtocol(scheme, async (params, abortController) => {
      const data = await radarTiles.fetch(fromRadarProtocolUrl(params.url), {
        signal: abortController.signal,
        priority: layer === frontLayer,
      })
      return { data }
    })
  }
}
