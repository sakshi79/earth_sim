/**
 * JSON client for one host that spaces requests at least `minIntervalMs` apart and caches
 * results in memory. Used for services with a requests-per-second policy (Nominatim, iNaturalist).
 */
export class PacedJsonClient {
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, Promise<unknown>>();
  private nextSlot = 0;

  constructor(minIntervalMs: number, timeoutMs = 10_000) {
    this.minIntervalMs = minIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  getJson<T>(url: string): Promise<T> {
    const cached = this.cache.get(url);
    if (cached) return cached as Promise<T>;

    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;

    const request = delay(wait)
      .then(() => fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) }))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.json() as Promise<T>;
      });
    this.cache.set(url, request);
    request.catch(() => this.cache.delete(url)); // let a later attempt retry
    return request;
  }
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
