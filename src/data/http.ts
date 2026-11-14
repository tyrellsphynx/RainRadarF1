export const REQUEST_TIMEOUT_MS = 10_000

/** GET a JSON document, failing on non-2xx responses and after `timeoutMs`. */
export async function fetchJson<T>(
  url: string,
  fetchFn: typeof fetch,
  label: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`${label} responded ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`${label} timed out after ${timeoutMs} ms`, { cause: err })
    throw err
  } finally {
    clearTimeout(timer)
  }
}
