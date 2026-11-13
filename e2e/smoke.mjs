/**
 * End-to-end smoke test against the production build.
 *
 * Self-contained: starts `vite preview` on the built dist/ (unless BASE_URL
 * points at an already-running server) and drives the real app with
 * Playwright: home → track dashboard → map → circuit list navigation.
 *
 *   npm run build && npm run test:e2e
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = Number(process.env.PORT ?? 4173)
// 127.0.0.1 explicitly: `localhost` can resolve to ::1 while vite listens on IPv4.
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
    // Spawn vite directly (not via npx) so cleanup kills the real process.
    // Pin the host: vite preview binds ::1 only by default, which breaks
    // 127.0.0.1 checks on dual-stack machines.
    server = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--strictPort',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let serverLog = ''
    server.stdout.on('data', (d) => (serverLog += d))
    server.stderr.on('data', (d) => (serverLog += d))
    try {
      await waitForServer(BASE)
    } catch (err) {
      throw new Error(
        `${err.message}\n--- vite preview output ---\n${serverLog || '(no output)'}`,
        { cause: err },
      )
    }
    pass(`preview server up at ${BASE}`)
  }

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })

  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  // ---- home: the shell and the schedule render ----
  console.log('Home')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar .brand', { timeout: 15_000 })
  pass('app shell renders')

  const cardWait = await page
    .waitForSelector('.session-list .session-card', { timeout: 25_000 })
    .then(() => true)
    .catch(() => false)
  const errorBox = await page.$('.error-box')
  if (errorBox) {
    fail('calendar loads', `app shows error state: ${await errorBox.innerText()}`)
  } else if (cardWait) {
    pass('calendar loads and session cards render')
  } else {
    fail('calendar loads', 'no session cards appeared')
  }

  // ---- track dashboard via the keyboard-accessible link path ----
  console.log('Track dashboard')
  const trackHref = await page
    .locator('a[href^="#/track/"]')
    .first()
    .getAttribute('href')
    .catch(() => null)
  if (trackHref) {
    await page.click(`a[href="${trackHref}"]`)
    await page.waitForSelector('.session-list .session-card', { timeout: 25_000 })
    pass(`track page renders (${trackHref})`)
    await page.waitForSelector('.track-map', { timeout: 15_000 })
    pass('track radar map mounts')
  } else {
    fail('track link found on home page')
  }

  // ---- map page + circuit list ----
  console.log('Map')
  await page.goto(`${BASE}/#/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.map-page .map-container', { timeout: 15_000 })
  pass('map page renders')
  const circuitLinks = await page.locator('.circuit-list a').count()
  if (circuitLinks > 0) {
    pass(`circuit list offers ${circuitLinks} keyboard-accessible links`)
  } else {
    fail('circuit list has links')
  }
  await page.locator('.circuit-list > summary').click() // open the details
  await page.locator('.circuit-list a').first().click()
  await page.waitForSelector('.session-list .session-card', { timeout: 25_000 })
  pass('circuit list navigates to a track dashboard')

  // ---- uncaught errors anywhere ----
  if (pageErrors.length === 0) {
    pass('no uncaught page errors')
  } else {
    fail('uncaught page errors', pageErrors.join(' | '))
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error(`  ✗ smoke test aborted — ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}

if (failures > 0) {
  console.error(`\nSMOKE FAILED (${failures} failure${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('\nSMOKE PASSED')
