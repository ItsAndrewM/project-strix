import { countOf, isJsonObject, type Crop, type JsonValue, type Rendition, textOf } from "./protocol.ts"

export type BitrateCaps = { readonly [rendition in Rendition]: number }

export interface ClipSpan {
  index: number
  startMs: number
  durationMs: number
}

export interface ProbeFacts {
  durationMs: number
  width: number
  height: number
}

export const FULL_CAPS: BitrateCaps = { "model-480": 1000, "model-720": 2000, view: 1000 }

export const HALF_CAPS: BitrateCaps = { "model-480": 500, "model-720": 1000, view: 500 }

const AUDIO: BitrateCaps = { "model-480": 64, "model-720": 64, view: 96 }

const MONO: ReadonlySet<Rendition> = new Set(["model-480", "model-720"])

const LABELS = { "model-480": "m480", "model-720": "m720", view: "view" } satisfies { [rendition in Rendition]: string }

const seconds = (ms: number): string => String(ms / 1000)

const rate = (kbps: number): string => (kbps % 1000 === 0 ? `${kbps / 1000}M` : `${kbps}k`)

const blind = (crop: Crop | null): string =>
  crop === null ? "" : `drawbox=x=${crop.x}:y=${crop.y}:w=${crop.width}:h=${crop.height}:color=black:t=fill,`

export const outputPath = (outDir: string, index: number, rendition: Rendition): string =>
  `${outDir}/${index}-${rendition}.mp4`

export const probeArgs = (source: string): string[] => [
  "-v",
  "error",
  "-print_format",
  "json",
  "-show_format",
  "-show_streams",
  source,
]

export const frameAtFor = (requestedMs: number, durationMs: number): number =>
  Math.min(requestedMs, Math.floor(durationMs / 2))

export const frameArgs = (source: string, atMs: number): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-ss",
  seconds(atMs),
  "-i",
  source,
  "-frames:v",
  "1",
  "-f",
  "image2pipe",
  "-vcodec",
  "mjpeg",
  "-",
]

const filterGraph = (crop: Crop | null): string =>
  [
    "[0:v]split=3[v480][v720][vview]",
    `[v480]${blind(crop)}scale=854:-2[m480]`,
    `[v720]${blind(crop)}scale=1280:-2[m720]`,
    "[vview]scale=854:-2[view]",
  ].join(";")

const outputArgs = (rendition: Rendition, path: string, caps: BitrateCaps): string[] => [
  "-map",
  `[${LABELS[rendition]}]`,
  "-map",
  "0:a?",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-pix_fmt",
  "yuv420p",
  "-maxrate",
  rate(caps[rendition]),
  "-bufsize",
  rate(caps[rendition] * 2),
  "-c:a",
  "aac",
  ...(MONO.has(rendition) ? ["-ac", "1"] : []),
  "-b:a",
  `${AUDIO[rendition]}k`,
  "-movflags",
  "+faststart",
  path,
]

export const sliceArgs = (
  source: string,
  window: ClipSpan,
  crop: Crop | null,
  outDir = "/tmp",
  caps = FULL_CAPS,
): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-ss",
  seconds(window.startMs),
  "-t",
  seconds(window.durationMs),
  "-i",
  source,
  "-filter_complex",
  filterGraph(crop),
  ...outputArgs("model-480", outputPath(outDir, window.index, "model-480"), caps),
  ...outputArgs("model-720", outputPath(outDir, window.index, "model-720"), caps),
  ...outputArgs("view", outputPath(outDir, window.index, "view"), caps),
]

const firstVideoStream = (streams: JsonValue | undefined): JsonValue | undefined =>
  Array.isArray(streams)
    ? streams.find((stream: JsonValue) => isJsonObject(stream) && stream.codec_type === "video")
    : undefined

const durationOf = (format: JsonValue | undefined): number | null => {
  const text = isJsonObject(format) ? textOf(format.duration) : null
  const value = text === null ? Number.NaN : Number.parseFloat(text)
  return Number.isFinite(value) ? Math.round(value * 1000) : null
}

export const readProbe = (output: JsonValue): ProbeFacts | null => {
  if (!isJsonObject(output)) return null
  const video = firstVideoStream(output.streams)
  const durationMs = durationOf(output.format)
  const width = isJsonObject(video) ? countOf(video.width) : null
  const height = isJsonObject(video) ? countOf(video.height) : null
  return durationMs === null || width === null || height === null ? null : { durationMs, width, height }
}
