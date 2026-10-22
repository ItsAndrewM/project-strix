import { describe, expect, it } from "vitest"
import {
  type RangeRecord,
  type Ranges,
  RANGE_TIMEOUT_MS,
  statusAfterRanges,
  timeOutRanges,
} from "../src/game/progress.ts"

const NOW = 1_800_000_000_000

const at = (status: RangeRecord["status"], startedAt = NOW): RangeRecord => ({ status, startedAt })

describe("statusAfterRanges", () => {
  it("is classifying once every range is done", () => {
    expect(statusAfterRanges({ 0: at("done"), 1: at("done") }, 40)).toBe("classifying")
  })

  it("is slicing while any range is running or queued", () => {
    expect(statusAfterRanges({ 0: at("done"), 1: at("running") }, 20)).toBe("slicing")
    expect(statusAfterRanges({ 0: at("failed"), 1: at("queued") }, 0)).toBe("slicing")
  })

  it("is failed when a range failed and no clip was recorded", () => {
    expect(statusAfterRanges({ 0: at("failed"), 1: at("done") }, 0)).toBe("failed")
  })

  it("keeps classifying when a range failed but clips were recorded", () => {
    expect(statusAfterRanges({ 0: at("failed"), 1: at("done") }, 1)).toBe("classifying")
    expect(statusAfterRanges({ 0: at("failed") }, 1)).toBe("classifying")
  })
})

describe("timeOutRanges", () => {
  it("fails a range running for more than 30 minutes", () => {
    const stalled = NOW - RANGE_TIMEOUT_MS - 1
    expect(timeOutRanges({ 0: at("running", stalled), 1: at("running") }, NOW)).toEqual({
      0: at("failed", stalled),
      1: at("running"),
    })
  })

  it("keeps a range running for exactly 30 minutes", () => {
    const ranges: Ranges = { 0: at("running", NOW - RANGE_TIMEOUT_MS) }
    expect(timeOutRanges(ranges, NOW)).toEqual(ranges)
  })

  it("keeps queued ranges while another range runs", () => {
    const ranges: Ranges = { 0: at("running"), 1: at("queued", NOW - RANGE_TIMEOUT_MS * 2) }
    expect(timeOutRanges(ranges, NOW)).toEqual(ranges)
  })

  it("fails queued ranges once nothing runs to start them", () => {
    const stalled = NOW - RANGE_TIMEOUT_MS - 1
    expect(timeOutRanges({ 0: at("running", stalled), 1: at("queued"), 2: at("done") }, NOW)).toEqual({
      0: at("failed", stalled),
      1: at("failed"),
      2: at("done"),
    })
  })
})
