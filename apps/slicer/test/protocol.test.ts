import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { decodeProbeRequest, decodeSliceRequest, type JsonValue, type SliceRequest } from "../src/protocol.ts"

const fixture: JsonValue = JSON.parse(readFileSync(new URL("../fixtures/slice-request.json", import.meta.url), "utf8"))

const PUTS = { "model-480": "a", "model-720": "b", view: "c" }

const sliceRequest = (overrides: { readonly [key: string]: JsonValue }): JsonValue => ({
  source: "https://x/y.mp4",
  crop: null,
  windows: [],
  ...overrides,
})

describe("decodeSliceRequest", () => {
  it("decodes the committed fixture into a SliceRequest", () => {
    const decoded: SliceRequest | null = decodeSliceRequest(fixture)
    expect(decoded).toEqual(fixture)
    expect(decoded?.windows).toHaveLength(1)
    expect(Object.keys(decoded?.windows[0]?.puts ?? {}).toSorted()).toEqual(["model-480", "model-720", "view"])
  })

  it("accepts a null crop and no windows", () => {
    expect(decodeSliceRequest(sliceRequest({}))).toEqual({ source: "https://x/y.mp4", crop: null, windows: [] })
  })

  it.each([
    ["a missing source", { source: null }],
    ["a crop missing its height", { crop: { x: 0, y: 0, width: 400 } }],
    ["a fractional crop", { crop: { x: 0.5, y: 0, width: 400, height: 60 } }],
    ["a crop with no width", { crop: { x: 0, y: 0, width: 0, height: 60 } }],
    ["a crop with no height", { crop: { x: 0, y: 0, width: 400, height: 0 } }],
    ["windows that are not an array", { windows: "none" }],
    [
      "a window missing the view put",
      { windows: [{ index: 0, startMs: 0, durationMs: 30000, puts: { ...PUTS, view: null } }] },
    ],
    ["a window with a negative start", { windows: [{ index: 0, startMs: -1, durationMs: 30000, puts: PUTS }] }],
    ["a window with no duration", { windows: [{ index: 0, startMs: 0, durationMs: 0, puts: PUTS }] }],
  ])("rejects %s", (_, overrides) => {
    expect(decodeSliceRequest(sliceRequest(overrides))).toBeNull()
  })

  it("rejects values that are not objects", () => {
    expect(decodeSliceRequest([fixture])).toBeNull()
    expect(decodeSliceRequest("request")).toBeNull()
    expect(decodeSliceRequest(null)).toBeNull()
  })
})

describe("decodeProbeRequest", () => {
  it("decodes a source and frame offset", () => {
    expect(decodeProbeRequest({ source: "https://x/y.mp4", frameAtMs: 1000 })).toEqual({
      source: "https://x/y.mp4",
      frameAtMs: 1000,
    })
  })

  it.each([
    ["a numeric source", { source: 1, frameAtMs: 1000 }],
    ["a missing frame offset", { source: "https://x/y.mp4" }],
    ["a string frame offset", { source: "https://x/y.mp4", frameAtMs: "1000" }],
  ])("rejects %s", (_, body) => {
    expect(decodeProbeRequest(body)).toBeNull()
  })
})
