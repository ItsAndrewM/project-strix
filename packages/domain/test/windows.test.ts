import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { RANGE_MS, STEP_MS, WINDOW_MS, rangesFor, windowsFor } from "../src/index.ts"

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

describe("constants", () => {
  it("uses 30 s windows every 25 s in 10 minute ranges", () => {
    expect([WINDOW_MS, STEP_MS, RANGE_MS]).toEqual([30_000, 25_000, 600_000])
  })
})

describe("windowsFor", () => {
  it("shortens the final window to the remaining duration", () => {
    expect(windowsFor(60_000)).toEqual([
      { index: 0, startMs: 0, durationMs: 30_000 },
      { index: 1, startMs: 25_000, durationMs: 30_000 },
      { index: 2, startMs: 50_000, durationMs: 10_000 },
    ])
  })

  it("keeps a final window of exactly 5,000 ms", () => {
    expect(windowsFor(30_000).map((w) => w.durationMs)).toEqual([30_000, 5_000])
  })

  it("drops a final window under 5,000 ms", () => {
    expect(windowsFor(54_999).map((w) => w.durationMs)).toEqual([30_000, 29_999])
    expect(windowsFor(29_999).map((w) => w.durationMs)).toEqual([29_999])
    expect(windowsFor(4_000)).toEqual([])
  })

  it("is empty for a zero duration", () => {
    expect(windowsFor(0)).toEqual([])
  })

  it("covers every millisecond of the video", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5_000, max: FOUR_HOURS_MS }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), { minLength: 5, maxLength: 5 }),
        (durationMs, fractions) => {
          const windows = windowsFor(durationMs)
          const samples = [0, durationMs - 1, ...fractions.map((f) => Math.floor(f * durationMs))]
          for (const t of samples) {
            expect(windows.some((w) => w.startMs <= t && t < w.startMs + w.durationMs)).toBe(true)
          }
        },
      ),
    )
  })

  it("indexes windows sequentially and never runs past the video", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FOUR_HOURS_MS }), (durationMs) => {
        windowsFor(durationMs).forEach((w, i) => {
          expect(w.index).toBe(i)
          expect(w.startMs).toBe(i * STEP_MS)
          expect(w.durationMs).toBeGreaterThanOrEqual(5_000)
          expect(w.durationMs).toBeLessThanOrEqual(WINDOW_MS)
          expect(w.startMs + w.durationMs).toBeLessThanOrEqual(durationMs)
        })
      }),
    )
  })
})

describe("rangesFor", () => {
  it("groups windows by the range their start falls in", () => {
    const ranges = rangesFor(1_250_000)
    expect(ranges.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 600_000],
      [600_000, 1_200_000],
      [1_200_000, 1_250_000],
    ])
    const second = ranges[1]
    expect(second?.windows.every((w) => w.startMs >= 600_000 && w.startMs < 1_200_000)).toBe(true)
    expect(second?.windows[0]?.startMs).toBe(600_000)
    expect(second?.windows.at(-1)?.startMs).toBe(1_175_000)
  })

  it("assigns every window to exactly one range", () => {
    expect(rangesFor(1_250_000).flatMap((r) => r.windows)).toEqual(windowsFor(1_250_000))
  })

  it("omits a range whose only window was dropped", () => {
    expect(rangesFor(602_000).map((r) => [r.startMs, r.endMs])).toEqual([[0, 600_000]])
  })

  it("is empty when there are no windows", () => {
    expect(rangesFor(4_000)).toEqual([])
  })
})
