import { describe, expect, it } from 'vitest'
import { fetchJson } from '../http'

describe('fetchJson', () => {
  it('returns parsed JSON', async () => {
    const fetchFn = (async () => new Response('{"a":1}')) as typeof fetch
    await expect(fetchJson('x', fetchFn, 'Test')).resolves.toEqual({ a: 1 })
  })

  it('names the source and status on HTTP errors', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as typeof fetch
    await expect(fetchJson('x', fetchFn, 'Test')).rejects.toThrow('Test responded 503')
  })

  it('aborts and reports a time-out when the server hangs', async () => {
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    await expect(fetchJson('x', hanging, 'Test', 20)).rejects.toThrow('Test timed out after 20 ms')
  })
})
