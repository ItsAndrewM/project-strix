/**
 * A game's containers are named by concurrency slot, not by range, so the seventh range runs on the container the
 * first one just freed instead of asking for a seventh instance while six are still idling towards their sleep.
 */
import { Container, getContainer } from "@cloudflare/containers"
import type { Env } from "../env.ts"
import {
  decodeProbeResult,
  decodeSliceProgress,
  isJsonObject,
  type JsonValue,
  type ProbeRequest,
  type SliceProgress,
  type SliceRequest,
  textOf,
} from "./protocol.ts"
import type { Slicer } from "./slicer.ts"

export class SlicerContainer extends Container<Env> {
  override defaultPort = 8080
  override sleepAfter = "2m"
}

type Send = (request: Request) => Promise<Response>

const parsed = (text: string): JsonValue => {
  try {
    const value: JsonValue = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

const errorOf = (body: string): string => {
  const value = parsed(body)
  const error = isJsonObject(value) ? textOf(value.error) : null
  return error ?? body
}

const post = async (send: Send, path: string, body: ProbeRequest | SliceRequest): Promise<Response> => {
  const response = await send(
    new Request(`http://slicer${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  )
  if (!response.ok) throw new Error(`slicer ${path} answered ${response.status}: ${errorOf(await response.text())}`)
  return response
}

const progressOf = (line: string): SliceProgress => {
  const progress = decodeSliceProgress(parsed(line))
  if (progress === null) throw new Error(`slicer sent an unexpected progress line: ${line}`)
  return progress
}

async function* linesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let pending = ""
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    const lines = `${pending}${chunk}`.split("\n")
    pending = lines.pop() ?? ""
    yield* lines
  }
  yield pending
}

const follow = async (body: ReadableStream<Uint8Array>, onProgress: (p: SliceProgress) => Promise<void>) => {
  for await (const line of linesOf(body)) {
    if (line.trim() === "") continue
    const progress = progressOf(line)
    await onProgress(progress)
    if (progress.kind === "done") return
  }
  throw new Error("slice stream ended without done")
}

export const slicerOver = (send: Send): Slicer => ({
  async probe(req) {
    const result = decodeProbeResult(await (await post(send, "/probe", req)).json())
    if (result === null) throw new Error("slicer sent a malformed probe result")
    return result
  },
  async slice(req, onProgress) {
    const response = await post(send, "/slice", req)
    if (response.body === null) throw new Error("slice stream ended without done")
    await follow(response.body, onProgress)
  },
})

export const containerSlicer = (
  namespace: DurableObjectNamespace<SlicerContainer>,
  gameId: string,
  slot: number,
): Slicer => {
  const container = getContainer(namespace, `${gameId}:${slot}`)
  return slicerOver((request) => container.fetch(request))
}
