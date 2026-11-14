import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { JsonCache } from './data/cache'
import { BATCH_KEY_PREFIX, FORECAST_KEY_PREFIX } from './data/openmeteo/client'
import './index.css'

// PWA: keep the app shell + cached tiles/API responses available offline.
registerSW({ immediate: true })

// Forecasts are keyed per coordinate pair and cache format; drop stale leftovers.
const cache = new JsonCache()
cache.prune(FORECAST_KEY_PREFIX, 2 * 86_400_000)
cache.prune(BATCH_KEY_PREFIX, 2 * 86_400_000)

// Radar tiles used to be cached by the service worker; that cache is dead weight now.
void globalThis.caches?.delete('rainviewer-tiles-v2')

const root = document.getElementById('root')
if (root === null) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
