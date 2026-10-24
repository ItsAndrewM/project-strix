/**
 * A slice job streams its progress back on the response, so a caller that goes away (its Durable Object reset or
 * evicted) leaves nobody to read it. The job must stop with it: the resumed range sends a new job to this same
 * container, and two encodes sharing one vCPU run each at half speed.
 */
export interface Closable {
  readonly writableFinished: boolean
  once(event: "close", listener: () => void): void
}

export const abortOnDisconnect = (res: Closable): AbortSignal => {
  const controller = new AbortController()
  res.once("close", () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller.signal
}
