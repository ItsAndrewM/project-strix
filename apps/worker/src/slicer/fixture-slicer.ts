import model480Clip0 from "../../fixtures/clips/0/model-480.mp4?inline"
import model720Clip0 from "../../fixtures/clips/0/model-720.mp4?inline"
import viewClip0 from "../../fixtures/clips/0/view.mp4?inline"
import model480Clip1 from "../../fixtures/clips/1/model-480.mp4?inline"
import model720Clip1 from "../../fixtures/clips/1/model-720.mp4?inline"
import viewClip1 from "../../fixtures/clips/1/view.mp4?inline"
import model480Clip2 from "../../fixtures/clips/2/model-480.mp4?inline"
import model720Clip2 from "../../fixtures/clips/2/model-720.mp4?inline"
import viewClip2 from "../../fixtures/clips/2/view.mp4?inline"
import probeFixture from "../../fixtures/probe.json"
import type { Env } from "../env.ts"
import type { Rendition, SliceWindow } from "./protocol.ts"
import type { Slicer } from "./slicer.ts"

export interface FixtureFailures {
  readonly probe: boolean
  readonly sliceAfter: number | null
}

type ClipFiles = { readonly [rendition in Rendition]: string }

type Sizes = { [rendition in Rendition]: number }

const CLIPS: readonly ClipFiles[] = [
  { "model-480": model480Clip0, "model-720": model720Clip0, view: viewClip0 },
  { "model-480": model480Clip1, "model-720": model720Clip1, view: viewClip1 },
  { "model-480": model480Clip2, "model-720": model720Clip2, view: viewClip2 },
]

const NO_FAILURES: FixtureFailures = { probe: false, sliceAfter: null }

const R2_SCHEME = "r2://"

const countFrom = (value: string | undefined): number | null => {
  if (value === undefined) return null
  if (!/^\d+$/.test(value)) throw new Error(`FIXTURES_FAIL_SLICE_AFTER must be a clip count, got "${value}"`)
  return Number(value)
}

export const fixtureFailuresOf = (env: Env): FixtureFailures => ({
  probe: env.FIXTURES_FAIL_PROBE === "1",
  sliceAfter: countFrom(env.FIXTURES_FAIL_SLICE_AFTER),
})

const keyOf = (url: string): string => {
  if (!url.startsWith(R2_SCHEME) || url.length === R2_SCHEME.length) {
    throw new Error(`the fixture slicer writes only to r2://<key> URLs, got ${url}`)
  }
  return url.slice(R2_SCHEME.length)
}

const BASE64_DATA_URL = /^data:[^,]*;base64,/

const bytesOf = (dataUrl: string): Uint8Array => {
  const prefix = BASE64_DATA_URL.exec(dataUrl)
  if (prefix === null) throw new Error(`fixture clip is not an inlined base64 data URL: ${dataUrl.slice(0, 40)}`)
  return Uint8Array.from(atob(dataUrl.slice(prefix[0].length)), (char) => char.charCodeAt(0))
}

const clipFor = (index: number): ClipFiles => {
  const clip = CLIPS[index % CLIPS.length]
  if (clip === undefined) throw new Error(`no fixture clip for window ${index}`)
  return clip
}

const writeWindow = async (bucket: R2Bucket, window: SliceWindow): Promise<Sizes> => {
  const keys = {
    "model-480": keyOf(window.puts["model-480"]),
    "model-720": keyOf(window.puts["model-720"]),
    view: keyOf(window.puts.view),
  }
  const clip = clipFor(window.index)
  const sizeOf = async (rendition: Rendition) =>
    (await bucket.put(keys[rendition], bytesOf(clip[rendition]), { httpMetadata: { contentType: "video/mp4" } })).size
  const [model480, model720, view] = await Promise.all([sizeOf("model-480"), sizeOf("model-720"), sizeOf("view")])
  return { "model-480": model480, "model-720": model720, view }
}

export const fixtureSlicer = (bucket: R2Bucket, failures: FixtureFailures = NO_FAILURES): Slicer => ({
  async probe() {
    if (failures.probe) throw new Error("fixture probe failed")
    return { ...probeFixture }
  },
  async slice(req, onProgress) {
    for (const [emitted, window] of req.windows.entries()) {
      if (emitted === failures.sliceAfter) throw new Error(`fixture slice failed after ${emitted} clips`)
      await onProgress({ kind: "clip", index: window.index, bytes: await writeWindow(bucket, window) })
    }
    await onProgress({ kind: "done" })
  },
})
