/**
 * Slicing progress, kept per range in the game's DO storage. A range is `queued` until a slot of the runner picks it
 * up, `running` while its slice job streams, then `done` or `failed` (with the reason). `startedAt` is when it last
 * changed to queued or running and `progressAt` when its job last reported a window, so a range that goes
 * `RANGE_TIMEOUT_MS` without progress is presumed dead however long it has run in total. A range recorded as running
 * whose job is not active in this instance was orphaned by a reset or eviction, as were the queued ranges once nothing
 * is active; the alarm resumes those (see ranges.ts) instead of failing them.
 *
 * Every window a failed range did not slice is recorded as an unsliced clip, so a game that settles with some of its
 * video missing says how much in its `failure`, while its status still follows the clips that were sliced.
 */
import type { GameStatus } from "@strix/contracts"
import { messageOf } from "../logs.ts"

export type RangeStatus = "queued" | "running" | "done" | "failed"

export interface RangeRecord {
  readonly status: RangeStatus
  readonly startedAt: number
  readonly progressAt?: number
  readonly reason?: string
}

export type Ranges = Readonly<Record<number, RangeRecord>>

export interface SliceCounts {
  readonly sliced: number
  readonly unsliced: number
}

export const RANGE_TIMEOUT_MS = 30 * 60_000
export const RANGE_TIMED_OUT = "timed out"
export const NO_CAPACITY = "no slicer capacity"
export const NO_CLIPS = "Slicing failed: no clips were recorded"

const CAPACITY_MESSAGE = /capacity|instance|placement|too many containers/iu

const inFlight = (record: RangeRecord): boolean => record.status === "queued" || record.status === "running"

const isFailed = (record: RangeRecord): boolean => record.status === "failed"

export const rangeFailureReason = (cause: unknown): string => {
  const message = messageOf(cause)
  return CAPACITY_MESSAGE.test(message) ? NO_CAPACITY : message
}

export const statusAfterRanges = (ranges: Ranges, slicedCount: number): GameStatus => {
  if (Object.values(ranges).some(inFlight)) return "slicing"
  return slicedCount === 0 ? "failed" : "classifying"
}

const noClipsFailure = (ranges: Ranges): string =>
  Object.values(ranges).some((record) => isFailed(record) && record.reason === NO_CAPACITY)
    ? `${NO_CAPACITY}: try again in a few minutes`
    : NO_CLIPS

const windowsMissing = (unsliced: number): string | null => {
  if (unsliced === 0) return null
  return `${unsliced} ${unsliced === 1 ? "window" : "windows"} could not be sliced`
}

export const failureAfterRanges = (ranges: Ranges, { sliced, unsliced }: SliceCounts): string | null =>
  sliced === 0 ? noClipsFailure(ranges) : windowsMissing(unsliced)

export const failedRangeIndexes = (ranges: Ranges): ReadonlyArray<number> =>
  Object.entries(ranges).flatMap(([index, record]) => (isFailed(record) ? [Number(index)] : []))

const mapRanges = (ranges: Ranges, change: (record: RangeRecord) => RangeRecord): Ranges =>
  Object.fromEntries(Object.entries(ranges).map(([index, record]) => [index, change(record)]))

const failedIf =
  (predicate: (record: RangeRecord) => boolean) =>
  (record: RangeRecord): RangeRecord =>
    predicate(record) ? { ...record, status: "failed", reason: RANGE_TIMED_OUT } : record

const isQueued = (record: RangeRecord): boolean => record.status === "queued"

const isRunning = (record: RangeRecord): boolean => record.status === "running"

const stalled = (record: RangeRecord, now: number): boolean =>
  isRunning(record) && now - (record.progressAt ?? record.startedAt) > RANGE_TIMEOUT_MS

export const timeOutRanges = (ranges: Ranges, now: number): Ranges =>
  mapRanges(
    ranges,
    failedIf((record) => stalled(record, now)),
  )

export const orphanedRangeIndexes = (ranges: Ranges, active: ReadonlySet<number>): ReadonlyArray<number> =>
  Object.entries(ranges).flatMap(([index, record]) => {
    const orphaned = isRunning(record) ? !active.has(Number(index)) : isQueued(record) && active.size === 0
    return orphaned ? [Number(index)] : []
  })
