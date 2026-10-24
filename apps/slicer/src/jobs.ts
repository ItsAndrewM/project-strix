/**
 * Every ffmpeg or ffprobe runs under its own time budget, so one that stalls on a hung read is killed and its container
 * slot freed instead of being held until the container is recycled. The budget is per process, not per job: a window
 * encodes in about a minute on one vCPU, so a range of twenty-four takes longer than any sane job budget, and the
 * worker times a range out on missing progress rather than on total time. A slice job also stops, killing its
 * process and cancelling its upload, the moment its `stop` signal fires (see disconnect.ts).
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BitrateCaps,
  FULL_CAPS,
  frameArgs,
  frameAtFor,
  HALF_CAPS,
  outputPath,
  probeArgs,
  readProbe,
  sliceArgs,
} from "./ffmpeg.ts"
import {
  type JsonValue,
  type ProbeRequest,
  type ProbeResult,
  type Rendition,
  RENDITIONS,
  type SliceProgress,
  type SliceRequest,
  type SliceWindow,
} from "./protocol.ts"

export const MAX_RENDITION_BYTES = 14 * 1024 * 1024

type Sizes = Extract<SliceProgress, { kind: "clip" }>["bytes"]

export const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export const PROBE_BUDGET_MS = 4 * 60_000
export const WINDOW_BUDGET_MS = 10 * 60_000

const exitError = (command: string, code: number | null, stderr: readonly Buffer[]): Error =>
  new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim().slice(-500)}`)

const killedError = (command: string, afterMs: number): Error =>
  new Error(`${command} killed after ${Math.round(afterMs / 1000)} s: the job's time budget is spent`)

const stoppedError = (command: string): Error => new Error(`${command} stopped: the caller went away`)

interface Exit {
  readonly command: string
  readonly code: number | null
  readonly killed: boolean
  readonly stopped: boolean
  readonly remainingMs: number
}

const exitOutcome = (
  { command, code, killed, stopped, remainingMs }: Exit,
  stderr: readonly Buffer[],
): Error | null => {
  if (stopped) return stoppedError(command)
  if (killed) return killedError(command, remainingMs)
  return code === 0 ? null : exitError(command, code, stderr)
}

const NEVER = new AbortController().signal

export const run = (command: string, args: readonly string[], deadline: number, stop = NEVER): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const remainingMs = deadline - Date.now()
    if (stop.aborted) return reject(stoppedError(command))
    if (remainingMs <= 0) return reject(killedError(command, 0))
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const kill = () => child.kill("SIGKILL")
    const timer = setTimeout(kill, remainingMs)
    stop.addEventListener("abort", kill, { once: true })
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      stop.removeEventListener("abort", kill)
      const exit = { command, code, killed: signal === "SIGKILL", stopped: stop.aborted, remainingMs }
      const failure = exitOutcome(exit, stderr)
      if (failure === null) resolve(Buffer.concat(stdout))
      else reject(failure)
    })
  })

const probeFacts = async (source: string, deadline: number, stop = NEVER) => {
  const output: JsonValue = JSON.parse((await run("ffprobe", probeArgs(source), deadline, stop)).toString("utf8"))
  const facts = readProbe(output)
  if (facts === null) throw new Error("source has no readable duration or video stream")
  return facts
}

export async function runProbe(req: ProbeRequest): Promise<ProbeResult> {
  const deadline = Date.now() + PROBE_BUDGET_MS
  const facts = await probeFacts(req.source, deadline)
  const frameAtMs = frameAtFor(req.frameAtMs, facts.durationMs)
  const frame = await run("ffmpeg", frameArgs(req.source, frameAtMs), deadline)
  if (frame.length === 0) throw new Error(`no frame at ${frameAtMs} ms`)
  return { ...facts, frameJpegBase64: frame.toString("base64") }
}

interface Job {
  readonly req: SliceRequest
  readonly stop: AbortSignal
}

const encode = async ({ req, stop }: Job, window: SliceWindow, outDir: string, caps: BitrateCaps): Promise<Sizes> => {
  await run("ffmpeg", sliceArgs(req.source, window, req.crop, outDir, caps), Date.now() + WINDOW_BUDGET_MS, stop)
  const sizeOf = async (rendition: Rendition) => (await stat(outputPath(outDir, window.index, rendition))).size
  const [model480, model720, view] = await Promise.all([sizeOf("model-480"), sizeOf("model-720"), sizeOf("view")])
  return { "model-480": model480, "model-720": model720, view }
}

const oversized = (sizes: Sizes): boolean => RENDITIONS.some((rendition) => sizes[rendition] > MAX_RENDITION_BYTES)

const upload = async (window: SliceWindow, outDir: string, stop: AbortSignal): Promise<string | null> => {
  for (const rendition of RENDITIONS) {
    const body = await readFile(outputPath(outDir, window.index, rendition))
    const response = await fetch(window.puts[rendition], {
      method: "PUT",
      body,
      headers: { "content-type": "video/mp4" },
      signal: stop,
    })
    await response.body?.cancel()
    if (!response.ok) return `upload of ${rendition} failed with ${response.status}`
  }
  return null
}

const sliceInto = async (job: Job, window: SliceWindow, outDir: string): Promise<SliceProgress> => {
  const first = await encode(job, window, outDir, FULL_CAPS)
  const sizes = oversized(first) ? await encode(job, window, outDir, HALF_CAPS) : first
  if (oversized(sizes)) return { kind: "failed", index: window.index, reason: "rendition over 14 MiB after re-encode" }
  const uploadFailure = await upload(window, outDir, job.stop)
  if (uploadFailure !== null) return { kind: "failed", index: window.index, reason: uploadFailure }
  return { kind: "clip", index: window.index, bytes: sizes }
}

const sliceWindow = async (job: Job, window: SliceWindow): Promise<SliceProgress> => {
  const outDir = await mkdtemp(join(tmpdir(), `strix-${window.index}-`))
  try {
    return await sliceInto(job, window, outDir)
  } catch (cause) {
    return { kind: "failed", index: window.index, reason: reasonOf(cause) }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

export async function runSlice(req: SliceRequest, emit: (p: SliceProgress) => void, stop = NEVER): Promise<void> {
  if (stop.aborted) return
  await probeFacts(req.source, Date.now() + PROBE_BUDGET_MS, stop)
  for (const window of req.windows) {
    const progress = await sliceWindow({ req, stop }, window)
    if (stop.aborted) return
    emit(progress)
  }
  emit({ kind: "done" })
}
