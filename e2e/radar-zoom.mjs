/**
 * Regression test: zooming must never stop the radar animation (the
 * user-reported "de radar stopt als ik inzoom" bug).
 *
 * Plays the world map's loop, zooms in and out, and asserts playback keeps
 * advancing after each move instead of freezing permanently. Tiles are
 * fulfilled with a transparent PNG so the run is deterministic (the request
 * budget in the scheduler still applies — cache misses cost budget exactly as
 * they do in production).
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
    let serverLog = ''
    server.stdout.on('data', (d) => (serverLog += d))
    server.stderr.on('data', (d) => (serverLog += d))
    try {
      await waitForServer(BASE)
    } catch (err) {
      throw new Error(`${err.message}\n--- vite preview output ---\n${serverLog || '(no output)'}`, {
        cause: err,
      })
    }
    pass(`preview server up at ${BASE}`)
  }

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  await context.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled for test'))
    }
  })

  // Deterministic tiles: instant, valid, and still counted against the budget.
  const TRANSPARENT_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  await context.route(/tilecache\.rainviewer\.com\/v2\/radar\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: TRANSPARENT_PNG,
    }),
  )

  const page = await context.newPage()
  await page.goto(`${BASE}/#/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-visible-frame]', { timeout: 60_000 })

  // The world map no longer autoplays (tile budget) — start playback.
  await page.click('button[aria-label="Play radar"]')

  let lastSeen = null
  /** Watch until the visible frame CHANGES; returns seconds waited, or -1 on timeout. */
  const advanceWithin = async (timeoutMs, what) => {
    const start = Date.now()
    const deadline = start + timeoutMs
    while (Date.now() < deadline) {
      const f = await page.getAttribute('[data-visible-frame]', 'data-visible-frame')
      if (f && f !== lastSeen) {
        lastSeen = f
        const secs = ((Date.now() - start) / 1000).toFixed(1)
        if (what) pass(`${what} (frame changed after ${secs}s)`)
        return true
      }
      await page.waitForTimeout(250)
    }
    if (what) fail(what, `no frame change within ${timeoutMs / 1000}s — animation frozen`)
    return false
  }

  // Baseline: the loop runs before anyone touches the map.
  await advanceWithin(15_000, 'radar animates before zooming')

  for (let i = 0; i < 3; i++) {
    await page.locator('.maplibregl-ctrl-zoom-in').click()
    await page.waitForTimeout(600)
  }
  // Zooming must not stop the animation — the classic bug froze it here forever.
  await advanceWithin(30_000, 'playback keeps advancing after zoom-in')

  // Let it run on a bit like real use (burns request budget), then zoom back.
  await page.waitForTimeout(5_000)
  for (let i = 0; i < 2; i++) {
    await page.locator('.maplibregl-ctrl-zoom-out').click()
    await page.waitForTimeout(600)
  }
  // A dry budget window may hold the first frame back for a while, but the
  // loop must always resume — and keep running afterwards.
  const first = await advanceWithin(60_000, 'playback recovers after zoom-out')
  if (first) await advanceWithin(60_000, 'and keeps animating (no permanently dead frames)')
}

try {
  await main()
} catch (err) {
  failures++
  console.error(`  ✗ zoom test aborted — ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}

if (failures > 0) {
  console.error(`\nZOOM FAILED (${failures} failure${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('\nZOOM PASSED')
