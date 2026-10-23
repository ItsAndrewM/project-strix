export const WINDOW_MS = 30_000
export const STEP_MS = 25_000
export const RANGE_MS = 600_000
const MIN_WINDOW_MS = 5_000

export interface Window {
  readonly index: number
  readonly startMs: number
  readonly durationMs: number
}

export interface Range {
  readonly startMs: number
  readonly endMs: number
  readonly windows: ReadonlyArray<Window>
}

export const windowsFor = (durationMs: number): ReadonlyArray<Window> => {
  const windows: Array<Window> = []
  for (let index = 0; index * STEP_MS < durationMs; index++) {
    const startMs = index * STEP_MS
    const windowMs = Math.min(WINDOW_MS, durationMs - startMs)
    if (windowMs >= MIN_WINDOW_MS) {
      windows.push({ index, startMs, durationMs: windowMs })
    }
  }
  return windows
}

export const rangesFor = (durationMs: number): ReadonlyArray<Range> => {
  const windows = windowsFor(durationMs)
  const ranges: Array<Range> = []
  for (let startMs = 0; startMs < durationMs; startMs += RANGE_MS) {
    const endMs = Math.min(startMs + RANGE_MS, durationMs)
    const inRange = windows.filter((w) => w.startMs >= startMs && w.startMs < endMs)
    if (inRange.length > 0) {
      ranges.push({ startMs, endMs, windows: inRange })
    }
  }
  return ranges
}
