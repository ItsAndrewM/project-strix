import { describe, expect, it } from "vitest"
import {
  failedRangeIndexes,
  failureAfterRanges,
  NO_CAPACITY,
  NO_CLIPS,
  RANGE_TIMED_OUT,
  type RangeRecord,
  type Ranges,
  RANGE_TIMEOUT_MS,
  rangeFailureReason,
  statusAfterRanges,
  timeOutRanges,
} from "../src/game/progress.ts"

const NOW = 1_800_000_000_000

const at = (status: RangeRecord["status"], startedAt = NOW): RangeRecord => ({ status, startedAt })

const failedFor = (reason: string, startedAt = NOW): RangeRecord => ({ status: "failed", startedAt, reason })

describe("statusAfterRanges", () => {
  it("is classifying once every range is done", () => {
    expect(statusAfterRanges({ 0: at("done"), 1: at("done") }, 40)).toBe("classifying")
  })

  it("is slicing while any range is running or queued", () => {
    expect(statusAfterRanges({ 0: at("done"), 1: at("running") }, 20)).toBe("slicing")
    expect(statusAfterRanges({ 0: at("failed"), 1: at("queued") }, 0)).toBe("slicing")
  })

  it("is failed when no clip was sliced", () => {
    expect(statusAfterRanges({ 0: at("failed"), 1: at("done") }, 0)).toBe("failed")
    expect(statusAfterRanges({ 0: at("done") }, 0)).toBe("failed")
  })

  it("keeps classifying when a range failed but clips were sliced", () => {
    expect(statusAfterRanges({ 0: at("failed"), 1: at("done") }, 1)).toBe("classifying")
    expect(statusAfterRanges({ 0: at("failed") }, 1)).toBe("classifying")
  })
})

describe("rangeFailureReason", () => {
  it.each([
    "slicer /slice answered 503: There is no Container instance available at this time.",
    "there is no container instance that can be provided to this durable object",
    "Max INSTANCES reached",
    "no capacity in region",
    "Placement failed",
    "you are requesting too many containers per second",
  ])("reads %j as no slicer capacity", (message) => {
    expect(rangeFailureReason(new Error(message))).toBe(NO_CAPACITY)
  })

  it("keeps any other message as it is", () => {
    expect(rangeFailureReason(new Error("slice stream ended without done"))).toBe("slice stream ended without done")
    expect(rangeFailureReason("socket hang up")).toBe("socket hang up")
  })
})

describe("failureAfterRanges", () => {
  it("is null when every window was sliced", () => {
    expect(failureAfterRanges({ 0: at("done") }, { sliced: 3, unsliced: 0 })).toBeNull()
  })

  it("counts the windows that could not be sliced", () => {
    expect(failureAfterRanges({ 0: failedFor("boom") }, { sliced: 1, unsliced: 2 })).toBe(
      "2 windows could not be sliced",
    )
    expect(failureAfterRanges({ 0: at("done") }, { sliced: 2, unsliced: 1 })).toBe("1 window could not be sliced")
  })

  it("says no clips were recorded when nothing was sliced", () => {
    expect(failureAfterRanges({ 0: failedFor("boom") }, { sliced: 0, unsliced: 3 })).toBe(NO_CLIPS)
  })

  it("asks to try again later when nothing was sliced for want of capacity", () => {
    const ranges: Ranges = { 0: failedFor(NO_CAPACITY), 1: failedFor("boom") }
    expect(failureAfterRanges(ranges, { sliced: 0, unsliced: 30 })).toBe(
      "no slicer capacity: try again in a few minutes",
    )
  })
})

describe("failedRangeIndexes", () => {
  it("lists the failed ranges", () => {
    expect(failedRangeIndexes({ 0: at("done"), 1: failedFor("boom"), 2: at("running"), 3: at("failed") })).toEqual([
      1, 3,
    ])
  })
})

describe("timeOutRanges", () => {
  it("fails a range running for more than 30 minutes", () => {
    const stalled = NOW - RANGE_TIMEOUT_MS - 1
    expect(timeOutRanges({ 0: at("running", stalled), 1: at("running") }, NOW)).toEqual({
      0: failedFor(RANGE_TIMED_OUT, stalled),
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
      0: failedFor(RANGE_TIMED_OUT, stalled),
      1: failedFor(RANGE_TIMED_OUT),
      2: at("done"),
    })
  })
})
