import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * maplibre-gl loads its tile-parsing worker via
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Bundlers don't
 * follow that reference, so the worker file must be placed next to the
 * emitted chunks (build) and served from the raw package (dev — see
 * optimizeDeps.exclude). Without this, no tiles render at all.
 */
function maplibreWorkerFix(): Plugin {
  const workerFile = path.resolve('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
  return {
    name: 'maplibre-worker-fix',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-worker.mjs',
        source: fs.readFileSync(workerFile),
      })
    },
  }
}

// Relative base so the app works from any sub-path (GitHub Pages project sites)
// and any custom domain without rebuilds.
export default defineConfig({
  base: './',
  optimizeDeps: {
    // Serve maplibre-gl raw in dev so import.meta.url points into
    // /node_modules/maplibre-gl/dist/ where the worker file lives.
    exclude: ['maplibre-gl'],
  },
  plugins: [
    react(),
    maplibreWorkerFix(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'RainRadarF1',
        short_name: 'RainRadarF1',
        description:
          'Will it rain during the sessions? Rain radar and per-session rain forecasts for every F1 circuit.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Radar tiles: immutable per frame path — cache-first is safe.
            urlPattern: /^https:\/\/tilecache\.rainviewer\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rainviewer-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Basemap tiles.
            urlPattern: /^https:\/\/(tiles\.openfreemap\.org|basemaps\.cartocdn\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // JSON APIs: network-first with a short timeout, then localStorage
            // caching at the data layer as the deeper fallback.
            urlPattern: /^https:\/\/(api\.jolpi\.ca|api\.open-meteo\.com|api\.rainviewer\.com)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather-apis',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
