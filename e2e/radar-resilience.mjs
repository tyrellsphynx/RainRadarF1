/**
 * Regression test: when a frame's radar tiles fail to load (CDN throttle,
 * dead path, flaky network), the map must keep showing the last good frame
 * instead of fading to a blank layer and "losing" the radar.
 *
 * Simulates the user-reported failure: tile requests for one specific frame
 * are aborted; playback runs through a full loop; the visible frame must
 * never become the broken one.
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

  // Keep the test deterministic: no service worker, so Playwright's route
  // interception sees every tile request directly.
  await context.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled for test'))
    }
  })

  const page = await context.newPage()

  // Abort every radar tile request for one chosen frame (decided once the
  // frame list is known) — this is the user's ERR_FAILED failure mode.
  let brokenHash = null
  await context.route(/tilecache\.rainviewer\.com\/v2\/radar\//, (route) => {
    const url = route.request().url()
    if (brokenHash !== null && url.includes(`/${brokenHash}/`)) {
      return route.abort('failed')
    }
    return route.continue()
  })

  await page.goto(`${BASE}/#/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-visible-frame]', { timeout: 60_000 })

  const frames = await page.evaluate(() => {
    const entry = JSON.parse(localStorage.getItem('rrf1:radar-frames'))
    return entry.value.past.map((f) => f.path)
  })
  // break a frame that playback reaches early (after the initial one)
  brokenHash = frames[2].split('/').pop()
  const brokenPath = frames[2]
  pass(`breaking tiles for frame ${brokenHash}`)

  // let autoplay run through more than one full loop (13 frames x 700 ms + fade)
  const seenVisible = new Set()
  const deadline = Date.now() + 16_000
  while (Date.now() < deadline) {
    const v = await page.getAttribute('[data-visible-frame]', 'data-visible-frame')
    if (v) seenVisible.add(v)
    await page.waitForTimeout(250)
  }

  console.log(`  (visible frames seen: ${seenVisible.size} of ${frames.length})`)
  if (!seenVisible.has(brokenPath)) {
    pass('map never faded to the frame whose tiles failed')
  } else {
    fail('map faded to a blank frame', `visible frame became ${brokenPath} despite failed tiles`)
  }
  if (seenVisible.size > 1) {
    pass('radar kept animating through the healthy frames')
  } else {
    fail('radar kept animating', 'only one visible frame was seen in 16 s of playback')
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error(`  ✗ resilience test aborted — ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}

if (failures > 0) {
  console.error(`\nRESILIENCE FAILED (${failures} failure${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('\nRESILIENCE PASSED')
