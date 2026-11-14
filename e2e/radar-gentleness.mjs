/**
 * Regression test: when radar tiles can't fetch, the app must stay gentle.
 *
 * Reproduces the "throttled/blocked tile host" scenario: after the first
 * ~2 frames' worth of requests, every tile request fails. The map used to
 * keep re-requesting every frame on every playback loop (a request storm
 * that keeps a rate-limited IP in the penalty box) while the timeline kept
 * moving over a frozen map. Now failed frames back off and are skipped.
 *
 * Asserts: total tile-request attempts stay bounded (no storm) while the
 * outage lasts.
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

  // No service worker: Playwright's route interception must see every tile
  // request directly.
  await context.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled for test'))
    }
  })

  const page = await context.newPage()

  // Outage simulation: allow the first `budget` tile requests (the "first
  // two blocks" the user sees), then fail everything for 30 s. Every attempt
  // is counted — a retry storm shows up as a huge number here.
  const BUDGET = 40
  const OUTAGE_MS = 30_000
  const MAX_ATTEMPTS = 120
  let attempts = 0
  let outageUntil = 0
  await context.route(/tilecache\.rainviewer\.com\/v2\/radar\//, (route) => {
    attempts++
    const now = Date.now()
    if (attempts > BUDGET && outageUntil === 0) outageUntil = now + OUTAGE_MS
    if (now < outageUntil || attempts > BUDGET) {
      return route.abort('failed')
    }
    return route.continue()
  })

  await page.goto(`${BASE}/#/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-visible-frame]', { timeout: 60_000 })

  // let playback run through the whole outage (3 loops of ~9 s)
  await page.waitForTimeout(OUTAGE_MS + 2_000)

  console.log(`  (tile request attempts during ${OUTAGE_MS / 1000}s outage: ${attempts})`)
  if (attempts <= MAX_ATTEMPTS) {
    pass(`tile requests stayed bounded (${attempts} ≤ ${MAX_ATTEMPTS}) — no retry storm`)
  } else {
    fail('no retry storm', `${attempts} tile request attempts in ${OUTAGE_MS / 1000}s (max ${MAX_ATTEMPTS})`)
  }

  // the frames that did verify must still be visible (held, not blank)
  const visible = await page.getAttribute('[data-visible-frame]', 'data-visible-frame')
  if (visible) {
    pass('map kept showing a verified frame during the outage')
  } else {
    fail('map kept showing a verified frame', 'no visible frame recorded')
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error(`  ✗ gentleness test aborted — ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}

if (failures > 0) {
  console.error(`\nGENTLENESS FAILED (${failures} failure${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('\nGENTLENESS PASSED')
