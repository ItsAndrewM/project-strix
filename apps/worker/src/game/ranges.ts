/**
 * The range runner. Each range of a started game becomes one slice job; up to six run at once. A job's clip lines are
 * recorded as they stream, so a job that dies mid-range fails only its range and keeps the clips it already recorded.
 * Requests (presigned URLs included) are built when a range begins, not when the game starts, so a range that waits
 * for a slot never carries expired URLs. Range records live in synchronous DO KV so concurrent ranges never lose an
 * update between a read and a write.
 */
import type { Clip, Rendition } from "@strix/contracts"
import type { Range } from "@strix/domain"
import { logRangeFailure } from "../logs.ts"
import type { SliceProgress, SliceRequest, SliceWindow } from "../slicer/protocol.ts"
import type { IngestDeps } from "./ingest.ts"
import { type RangeStatus, type Ranges, statusAfterRanges, timeOutRanges } from "./progress.ts"
import { changeGame, countsOf, markClassification, readGame } from "./store.ts"

export const SLICING_CHECK_MS = 60_000

const RANGES_KEY = "ranges"
const CONCURRENT_RANGES = 6
const NO_CLIPS = "Slicing failed: no clips were recorded"
const CLIP_RENDITIONS: ReadonlyArray<Rendition> = ["model-480", "model-720", "view"]

export const readRanges = (storage: DurableObjectStorage): Ranges => storage.kv.get<Ranges>(RANGES_KEY) ?? {}

const writeRanges = (storage: DurableObjectStorage, ranges: Ranges): void => {
  storage.kv.put(RANGES_KEY, ranges)
}

export const queueRanges = (storage: DurableObjectStorage, count: number, now: number): void => {
  writeRanges(
    storage,
    Object.fromEntries(Array.from({ length: count }, (_, index) => [index, { status: "queued", startedAt: now }])),
  )
}

const markRange = (storage: DurableObjectStorage, index: number, status: RangeStatus): void => {
  const ranges = readRanges(storage)
  const startedAt = status === "running" ? Date.now() : (ranges[index]?.startedAt ?? Date.now())
  writeRanges(storage, { ...ranges, [index]: { status, startedAt } })
}

const putsFor = async (deps: IngestDeps, index: number): Promise<SliceWindow["puts"]> => {
  const put = (rendition: Rendition) => deps.urls.put(`clips/${deps.gameId}/${index}/${rendition}.mp4`)
  const [model480, model720, view] = await Promise.all([put("model-480"), put("model-720"), put("view")])
  return { "model-480": model480, "model-720": model720, view }
}

const sliceRequestFor = async (deps: IngestDeps, range: Range): Promise<SliceRequest> => {
  const game = readGame(deps.ctx.storage.sql)
  if (game?.source == null) throw new Error("a started game has no source")
  const source = game.source.kind === "url" ? game.source.url : await deps.urls.get(game.source.key)
  const windows = await Promise.all(
    range.windows.map(async ({ index, startMs, durationMs }) => ({
      index,
      startMs,
      durationMs,
      puts: await putsFor(deps, index),
    })),
  )
  return { source, crop: game.crop, windows }
}

const clipOf = (range: Range, index: number): Clip => {
  const window = range.windows.find((candidate) => candidate.index === index)
  if (window === undefined) throw new Error(`the slicer reported window ${index}, which its range does not hold`)
  return {
    index,
    startMs: window.startMs,
    durationMs: window.durationMs,
    renditions: CLIP_RENDITIONS,
    state: null,
    stateConfidence: null,
    classification: "pending",
  }
}

const progressFor =
  (deps: IngestDeps, range: Range) =>
  async (progress: SliceProgress): Promise<void> => {
    if (progress.kind === "clip") {
      await deps.clipReady(clipOf(range, progress.index))
    } else if (progress.kind === "failed") {
      markClassification(deps.ctx.storage.sql, progress.index, "failed", null, null)
      await deps.publish(["clips"])
    }
  }

const runRange = async (deps: IngestDeps, index: number, range: Range): Promise<void> => {
  const { storage } = deps.ctx
  if (readRanges(storage)[index]?.status !== "queued") return
  markRange(storage, index, "running")
  try {
    const slicer = await deps.slicer(index)
    await slicer.slice(await sliceRequestFor(deps, range), progressFor(deps, range))
    markRange(storage, index, "done")
  } catch (cause) {
    logRangeFailure(deps.gameId, index, cause)
    markRange(storage, index, "failed")
  }
}

const settle = async (deps: IngestDeps): Promise<void> => {
  const { storage } = deps.ctx
  if (readGame(storage.sql)?.status !== "slicing") return
  const status = statusAfterRanges(readRanges(storage), countsOf(storage.sql).clips)
  if (status === "slicing") return
  changeGame(storage.sql, (game) => ({ ...game, status, failure: status === "failed" ? NO_CLIPS : null }))
  await deps.publish(["game"])
}

export const runRanges = async (deps: IngestDeps, ranges: ReadonlyArray<Range>): Promise<void> => {
  const pending = [...ranges.entries()]
  const slot = async (): Promise<void> => {
    const next = pending.shift()
    if (next === undefined) return
    await runRange(deps, ...next)
    await slot()
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_RANGES, pending.length) }, slot))
  await settle(deps)
}

export const checkRanges = async (deps: IngestDeps): Promise<void> => {
  const { storage } = deps.ctx
  if (readGame(storage.sql)?.status !== "slicing") return
  writeRanges(storage, timeOutRanges(readRanges(storage), Date.now()))
  await settle(deps)
  if (readGame(storage.sql)?.status === "slicing") await storage.setAlarm(Date.now() + SLICING_CHECK_MS)
}
