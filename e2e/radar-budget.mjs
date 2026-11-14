/**
 * Regression test: radar tile traffic must stay inside RainViewer's rate
 * limit (100 requests/IP/minute). Over the limit RainViewer answers 429 with
 * no CORS headers, which browsers report as one opaque net::ERR_FAILED per
 * tile — the console flood users saw.
 *
 * Tile requests are answered instantly from a stub, and the viewport is large
 * enough that a full playback loop needs more distinct tiles than the budget
 * allows. Without the client-side budget they would all fire within seconds.
 * Asserts: the budget caps them, the radar still animates, the console stays clean.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = Number(process.env.PORT ?? 4173)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`
const EXTERNAL = Boolean(process.env.BASE_URL)

let server = null
let browser = null
let failures = 0

function pass(name) {
  console.log(`  ✓ ${name}`)
}

function fail(name, detail) {
  failures++
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Preview server did not come up at ${url}`)
}

async function main() {
  if (!EXTERNAL) {
    server = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    await waitForServer(BASE)
    pass(`preview server up at ${BASE}`)
  }

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 2400, height: 1500 } })
  await context.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled for test'))
    }
  })
  const page = await context.newPage()

  const TRANSPARENT_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  const WINDOW_MS = 20_000
  const MAX_REQUESTS = 85 // budget is 80 per minute
  let tileRequests = 0
  await context.route(/tilecache\.rainviewer\.com\/v2\/radar\//, (route) => {
    tileRequests++
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: TRANSPARENT_PNG,
    })
  })

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(`${BASE}/#/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-visible-frame]', { timeout: 60_000 })
  await page.click('button[aria-label="Play radar"]')

  const seen = new Set()
  const deadline = Date.now() + WINDOW_MS
  while (Date.now() < deadline) {
    const v = await page.getAttribute('[data-visible-frame]', 'data-visible-frame')
    if (v) seen.add(v)
    await page.waitForTimeout(250)
  }

  console.log(`  (tile requests in ${WINDOW_MS / 1000}s of playback: ${tileRequests}, frames shown: ${seen.size})`)
  if (tileRequests > 0 && tileRequests <= MAX_REQUESTS) {
    pass(`tile requests stayed inside the budget (${tileRequests} ≤ ${MAX_REQUESTS})`)
  } else {
    fail('tile request budget', `${tileRequests} requests (expected 1–${MAX_REQUESTS})`)
  }
  if (seen.size >= 2) {
    pass('radar kept animating within the budget')
  } else {
    fail('radar kept animating', `only ${seen.size} frame(s) shown`)
  }
  if (consoleErrors.length === 0) {
    pass('no console errors')
  } else {
    fail('console stayed clean', consoleErrors.slice(0, 3).join(' | '))
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error(`  ✗ budget test aborted — ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}

if (failures > 0) {
  console.error(`\nBUDGET FAILED (${failures} failure${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('\nBUDGET PASSED')
