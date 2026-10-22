/**
 * Slicing progress, kept per range in the game's DO storage. A range is `queued` until a slot of the runner picks it
 * up, `running` while its slice job streams, then `done` or `failed`. `startedAt` is when it last changed to queued or
 * running. A range running past `RANGE_TIMEOUT_MS` is presumed dead; once nothing runs, nothing will start the queued
 * ranges either, so they fail with it.
 */
import type { GameStatus } from "@strix/contracts"

export type RangeStatus = "queued" | "running" | "done" | "failed"

export interface RangeRecord {
  readonly status: RangeStatus
  readonly startedAt: number
}

export type Ranges = Readonly<Record<number, RangeRecord>>

export const RANGE_TIMEOUT_MS = 30 * 60_000

const inFlight = (record: RangeRecord): boolean => record.status === "queued" || record.status === "running"

export const statusAfterRanges = (ranges: Ranges, clipCount: number): GameStatus => {
  const records = Object.values(ranges)
  if (records.some(inFlight)) return "slicing"
  if (records.some((record) => record.status === "failed") && clipCount === 0) return "failed"
  return "classifying"
}

const mapRanges = (ranges: Ranges, change: (record: RangeRecord) => RangeRecord): Ranges =>
  Object.fromEntries(Object.entries(ranges).map(([index, record]) => [index, change(record)]))

const failedIf =
  (predicate: (record: RangeRecord) => boolean) =>
  (record: RangeRecord): RangeRecord =>
    predicate(record) ? { ...record, status: "failed" } : record

const isQueued = (record: RangeRecord): boolean => record.status === "queued"

const isRunning = (record: RangeRecord): boolean => record.status === "running"

export const timeOutRanges = (ranges: Ranges, now: number): Ranges => {
  const stalled = (record: RangeRecord) => isRunning(record) && now - record.startedAt > RANGE_TIMEOUT_MS
  const timedOut = mapRanges(ranges, failedIf(stalled))
  return Object.values(timedOut).some(isRunning) ? timedOut : mapRanges(timedOut, failedIf(isQueued))
}
