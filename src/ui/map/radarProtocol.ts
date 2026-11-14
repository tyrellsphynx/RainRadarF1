import * as maplibregl from 'maplibre-gl'
import { fromRadarProtocolUrl, RADAR_PROTOCOL } from '../../data/rainviewer/client'
import { radarTiles } from '../../data/rainviewer/tiles'

let registered = false

/** Route `rvtile://` tile requests from MapLibre through the shared request budget. */
export function ensureRadarProtocol(): void {
  if (registered) return
  registered = true
  maplibregl.addProtocol(RADAR_PROTOCOL, async (params, abortController) => {
    const data = await radarTiles.fetch(fromRadarProtocolUrl(params.url), {
      signal: abortController.signal,
    })
    return { data }
  })
}
