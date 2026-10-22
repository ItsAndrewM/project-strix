/**
 * Wire protocol between the worker's SlicerContainer and this server. The worker re-declares these types by copy,
 * so this module imports nothing. JSON bodies are narrowed without `typeof`: `Number.isInteger`, `Array.isArray`,
 * `Object(value) === value` and `String(value) === value` each hold only for the JSON kind they name.
 */

export type Rendition = "model-480" | "model-720" | "view"

export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

export interface ProbeRequest {
  source: string
  frameAtMs: number
}

export interface ProbeResult {
  durationMs: number
  width: number
  height: number
  frameJpegBase64: string
}

export interface SliceWindow {
  index: number
  startMs: number
  durationMs: number
  puts: { "model-480": string; "model-720": string; view: string }
}

export interface SliceRequest {
  source: string
  crop: Crop | null
  windows: Array<SliceWindow>
}

export type SliceProgress =
  | { kind: "clip"; index: number; bytes: { "model-480": number; "model-720": number; view: number } }
  | { kind: "failed"; index: number; reason: string }
  | { kind: "done" }

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject

export type JsonObject = { readonly [key: string]: JsonValue }

export const RENDITIONS: readonly Rendition[] = ["model-480", "model-720", "view"]

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) && Object(value) === value
}

export function textOf(value: JsonValue | undefined): string | null {
  return value !== undefined && value !== null && String(value) === value ? value : null
}

export function countOf(value: JsonValue | undefined): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function decodeCrop(value: JsonValue | undefined): Crop | null {
  if (!isJsonObject(value)) return null
  const [x, y, width, height] = [countOf(value.x), countOf(value.y), countOf(value.width), countOf(value.height)]
  if (x === null || y === null || width === null || height === null) return null
  return { x, y, width, height }
}

function decodePuts(value: JsonValue | undefined): SliceWindow["puts"] | null {
  if (!isJsonObject(value)) return null
  const [model480, model720, view] = RENDITIONS.map((rendition) => textOf(value[rendition]))
  if (model480 == null || model720 == null || view == null) return null
  return { "model-480": model480, "model-720": model720, view }
}

function decodeWindow(value: JsonValue): SliceWindow | null {
  if (!isJsonObject(value)) return null
  const [index, startMs, durationMs] = [countOf(value.index), countOf(value.startMs), countOf(value.durationMs)]
  const puts = decodePuts(value.puts)
  if (index === null || startMs === null || !durationMs || puts === null) return null
  return { index, startMs, durationMs, puts }
}

function decodeWindows(value: JsonValue | undefined): Array<SliceWindow> | null {
  if (!Array.isArray(value)) return null
  const windows = value.map(decodeWindow)
  return windows.every((window) => window !== null) ? windows : null
}

export function decodeSliceRequest(value: JsonValue): SliceRequest | null {
  if (!isJsonObject(value)) return null
  const source = textOf(value.source)
  const crop = value.crop === null ? null : decodeCrop(value.crop)
  const windows = decodeWindows(value.windows)
  if (source === null || (crop === null && value.crop !== null) || windows === null) return null
  return { source, crop, windows }
}

export function decodeProbeRequest(value: JsonValue): ProbeRequest | null {
  if (!isJsonObject(value)) return null
  const source = textOf(value.source)
  const frameAtMs = countOf(value.frameAtMs)
  return source === null || frameAtMs === null ? null : { source, frameAtMs }
}
