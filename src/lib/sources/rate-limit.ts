/** Serializes calls so consecutive requests are at least minIntervalMs apart. */
export function createRateLimiter(minIntervalMs: number) {
  let tail = Promise.resolve()
  let last = 0
  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      return fn()
    })
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}
