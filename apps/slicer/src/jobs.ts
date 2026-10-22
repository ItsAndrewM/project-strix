import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BitrateCaps,
  FULL_CAPS,
  frameArgs,
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

const run = (command: string, args: readonly string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout))
      else reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim().slice(-500)}`))
    })
  })

const probeFacts = async (source: string) => {
  const output: JsonValue = JSON.parse((await run("ffprobe", probeArgs(source))).toString("utf8"))
  const facts = readProbe(output)
  if (facts === null) throw new Error("source has no readable duration or video stream")
  return facts
}

export async function runProbe(req: ProbeRequest): Promise<ProbeResult> {
  const facts = await probeFacts(req.source)
  const frame = await run("ffmpeg", frameArgs(req.source, req.frameAtMs))
  if (frame.length === 0) throw new Error(`no frame at ${req.frameAtMs} ms`)
  return { ...facts, frameJpegBase64: frame.toString("base64") }
}

const encode = async (req: SliceRequest, window: SliceWindow, outDir: string, caps: BitrateCaps): Promise<Sizes> => {
  await run("ffmpeg", sliceArgs(req.source, window, req.crop, outDir, caps))
  const sizeOf = async (rendition: Rendition) => (await stat(outputPath(outDir, window.index, rendition))).size
  const [model480, model720, view] = await Promise.all([sizeOf("model-480"), sizeOf("model-720"), sizeOf("view")])
  return { "model-480": model480, "model-720": model720, view }
}

const oversized = (sizes: Sizes): boolean => RENDITIONS.some((rendition) => sizes[rendition] > MAX_RENDITION_BYTES)

const upload = async (window: SliceWindow, outDir: string): Promise<string | null> => {
  for (const rendition of RENDITIONS) {
    const body = await readFile(outputPath(outDir, window.index, rendition))
    const response = await fetch(window.puts[rendition], {
      method: "PUT",
      body,
      headers: { "content-type": "video/mp4" },
    })
    await response.body?.cancel()
    if (!response.ok) return `upload of ${rendition} failed with ${response.status}`
  }
  return null
}

const sliceInto = async (req: SliceRequest, window: SliceWindow, outDir: string): Promise<SliceProgress> => {
  const first = await encode(req, window, outDir, FULL_CAPS)
  const sizes = oversized(first) ? await encode(req, window, outDir, HALF_CAPS) : first
  if (oversized(sizes)) return { kind: "failed", index: window.index, reason: "rendition over 14 MiB after re-encode" }
  const uploadFailure = await upload(window, outDir)
  if (uploadFailure !== null) return { kind: "failed", index: window.index, reason: uploadFailure }
  return { kind: "clip", index: window.index, bytes: sizes }
}

const sliceWindow = async (req: SliceRequest, window: SliceWindow): Promise<SliceProgress> => {
  const outDir = await mkdtemp(join(tmpdir(), `strix-${window.index}-`))
  try {
    return await sliceInto(req, window, outDir)
  } catch (cause) {
    return { kind: "failed", index: window.index, reason: reasonOf(cause) }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

export async function runSlice(req: SliceRequest, emit: (p: SliceProgress) => void): Promise<void> {
  await probeFacts(req.source)
  for (const window of req.windows) {
    emit(await sliceWindow(req, window))
  }
  emit({ kind: "done" })
}
