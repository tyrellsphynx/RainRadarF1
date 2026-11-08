import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })

page.on('console', (msg) => {
  const type = msg.type()
  if (type === 'error' || type === 'warning') console.log(`[console.${type}]`, msg.text())
})
page.on('pageerror', (err) => console.log('[pageerror]', err.message))
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText))
page.on('response', (res) => {
  if (res.status() >= 400) console.log('[http ' + res.status() + ']', res.url())
})

for (const [name, hash] of [
  ['track', '#/track/2026-23'],
  ['map', '#/map'],
]) {
  console.log(`\n===== ${name} page =====`)
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' }).catch((e) => console.log('[goto]', e.message))
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `/tmp/rrf1-${name}.png` })
  console.log(`screenshot: /tmp/rrf1-${name}.png`)
}

await browser.close()
