/**
 * Clip media routes. The view rendition streams from R2 with byte-range support so the player can seek. The clip
 * thumbnail is a frame cut from the view rendition by Media Transformations the first time it is asked for (15 s in, or
 * the middle of a shorter clip, in whole seconds as the `time` option takes them), then kept in R2; the fixture environment has no Media Transformations and stores the probe fixture's frame instead.
 *
 * Real R2 throws on an unsatisfiable range while the local simulator serves the whole object, so both are answered 416.
 */
import { type Clip, NotFound, ServiceUnavailable } from "@strix/contracts"
import probeFixture from "../../fixtures/probe.json"
import type { Env } from "../env.ts"
import { errorResponse } from "../error-response.ts"
import { logThumbFailure, logViewFailure, messageOf } from "../logs.ts"
import { bytesOf } from "./ingest.ts"

const MEDIA_CACHE = "private, max-age=3600"
const THUMB_FRAME_AT_MS = 15_000
const BYTE_RANGE = /^bytes=(?:(\d+)-\d*|-(\d+))$/

class FrameFailed extends Error {
  constructor(readonly status: number) {
    super(`media transformation answered ${status}`)
  }
}

export const thumbTimeOf = (durationMs: number): string =>
  `${Math.floor(Math.min(THUMB_FRAME_AT_MS, durationMs / 2) / 1000)}s`

const viewKey = (gameId: string, index: number): string => `clips/${gameId}/${index}/view.mp4`
const thumbKey = (gameId: string, index: number): string => `thumbs/${gameId}/${index}.jpg`

interface Span {
  readonly start: number
  readonly length: number
}

const spanOf = ({ range, size }: R2ObjectBody): Span => {
  if (range === undefined) return { start: 0, length: size }
  if ("offset" in range || "length" in range) {
    const start = range.offset ?? 0
    return { start, length: range.length ?? size - start }
  }
  return { start: size - range.suffix, length: range.suffix }
}

const byteRangeOf = (request: Request): RegExpExecArray | null =>
  BYTE_RANGE.exec(request.headers.get("range")?.trim() ?? "")

const startsPastEnd = ([, first, suffix]: RegExpExecArray, size: number): boolean =>
  first === undefined ? Number(suffix) === 0 : Number(first) >= size

const isUnsatisfiable = (cause: unknown): boolean => messageOf(cause).includes("not satisfiable")

const viewHeaders = (length: number): Headers =>
  new Headers({
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "content-length": String(length),
    "cache-control": MEDIA_CACHE,
  })

const notSatisfiable = (size: number): Response =>
  new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } })

const partial = (object: R2ObjectBody): Response => {
  const { start, length } = spanOf(object)
  const headers = viewHeaders(length)
  headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`)
  return new Response(object.body, { status: 206, headers })
}

const getView = async (env: Env, key: string, range: Headers | null): Promise<R2ObjectBody | Response | null> => {
  try {
    return await env.BUCKET.get(key, range === null ? {} : { range })
  } catch (cause) {
    if (range === null || !isUnsatisfiable(cause)) throw cause
    const head = await env.BUCKET.head(key)
    return head === null ? null : notSatisfiable(head.size)
  }
}

const respondToView = async (env: Env, gameId: string, index: number, request: Request): Promise<Response> => {
  const byteRange = byteRangeOf(request)
  const object = await getView(env, viewKey(gameId, index), byteRange === null ? null : request.headers)
  if (object === null) return errorResponse(new NotFound())
  if (object instanceof Response) return object
  if (byteRange === null) return new Response(object.body, { headers: viewHeaders(object.size) })
  if (!startsPastEnd(byteRange, object.size)) return partial(object)
  await object.body.cancel()
  return notSatisfiable(object.size)
}

export const serveView = async (env: Env, gameId: string, index: number, request: Request): Promise<Response> => {
  try {
    return await respondToView(env, gameId, index, request)
  } catch (cause) {
    logViewFailure(gameId, index, cause)
    return errorResponse(new ServiceUnavailable())
  }
}

const frameFromView = async (env: Env, view: ReadableStream<Uint8Array>, time: string): Promise<Uint8Array> => {
  const response = await env.MEDIA.input(view).output({ mode: "frame", time, format: "jpg" }).response()
  if (!response.ok) throw new FrameFailed(response.status)
  return new Uint8Array(await response.arrayBuffer())
}

const thumbBytes = async (env: Env, gameId: string, clip: Clip): Promise<Uint8Array | null> => {
  if (env.FIXTURES === "1") return bytesOf(probeFixture.frameJpegBase64)
  const view = await env.BUCKET.get(viewKey(gameId, clip.index))
  return view === null ? null : frameFromView(env, view.body, thumbTimeOf(clip.durationMs))
}

const jpeg = (body: BodyInit | null): Response =>
  new Response(body, { headers: { "content-type": "image/jpeg", "cache-control": MEDIA_CACHE } })

export const serveThumb = async (env: Env, gameId: string, clip: Clip): Promise<Response> => {
  const { index } = clip
  const key = thumbKey(gameId, index)
  const stored = await env.BUCKET.get(key)
  if (stored !== null) return jpeg(stored.body)
  try {
    const bytes = await thumbBytes(env, gameId, clip)
    if (bytes === null) return errorResponse(new NotFound())
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } })
    return jpeg(bytes)
  } catch (cause) {
    logThumbFailure(gameId, index, cause instanceof FrameFailed ? cause.status : null, cause)
    return errorResponse(new ServiceUnavailable())
  }
}
