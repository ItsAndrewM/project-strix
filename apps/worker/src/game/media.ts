/**
 * Clip media routes. The view rendition streams from R2 with byte-range support so the player can seek. The clip
 * thumbnail is a frame cut from the view rendition by Media Transformations the first time it is asked for, then kept
 * in R2; the fixture environment has no Media Transformations and stores the probe fixture's frame instead.
 *
 * Real R2 throws on an unsatisfiable range while the local simulator serves the whole object, so both are answered 416.
 */
import { NotFound, ServiceUnavailable } from "@strix/contracts"
import probeFixture from "../../fixtures/probe.json"
import type { Env } from "../env.ts"
import { errorResponse } from "../error-response.ts"
import { bytesOf } from "./ingest.ts"

const MEDIA_CACHE = "private, max-age=3600"
const THUMB_FRAME_AT = "15s"
const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/

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

const startsPastEnd = (rangeHeader: string, size: number): boolean => {
  const [, first = "", last = ""] = BYTE_RANGE.exec(rangeHeader.trim()) ?? []
  return first === "" ? last !== "" && Number(last) === 0 : Number(first) >= size
}

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

const getView = async (env: Env, key: string, request: Request): Promise<R2ObjectBody | Response | null> => {
  try {
    return await env.BUCKET.get(key, { range: request.headers })
  } catch (cause) {
    if (!request.headers.has("range")) throw cause
    const head = await env.BUCKET.head(key)
    return head === null ? null : notSatisfiable(head.size)
  }
}

export const serveView = async (env: Env, gameId: string, index: number, request: Request): Promise<Response> => {
  const object = await getView(env, viewKey(gameId, index), request)
  if (object === null) return errorResponse(new NotFound())
  if (object instanceof Response) return object
  const rangeHeader = request.headers.get("range")
  if (rangeHeader === null) return new Response(object.body, { headers: viewHeaders(object.size) })
  if (!startsPastEnd(rangeHeader, object.size)) return partial(object)
  await object.body.cancel()
  return notSatisfiable(object.size)
}

const frameFromView = async (env: Env, view: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const response = await env.MEDIA.input(view).output({ mode: "frame", time: THUMB_FRAME_AT, format: "jpg" }).response()
  if (!response.ok) throw new ServiceUnavailable()
  return new Uint8Array(await response.arrayBuffer())
}

const thumbBytes = async (env: Env, gameId: string, index: number): Promise<Uint8Array | null> => {
  if (env.FIXTURES === "1") return bytesOf(probeFixture.frameJpegBase64)
  const view = await env.BUCKET.get(viewKey(gameId, index))
  return view === null ? null : frameFromView(env, view.body)
}

const jpeg = (body: BodyInit | null): Response =>
  new Response(body, { headers: { "content-type": "image/jpeg", "cache-control": MEDIA_CACHE } })

export const serveThumb = async (env: Env, gameId: string, index: number): Promise<Response> => {
  const key = thumbKey(gameId, index)
  const stored = await env.BUCKET.get(key)
  if (stored !== null) return jpeg(stored.body)
  const bytes = await thumbBytes(env, gameId, index)
  if (bytes === null) return errorResponse(new NotFound())
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } })
  return jpeg(bytes)
}
