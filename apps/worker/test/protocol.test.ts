import { describe, expect, it } from "vitest"
import sliceRequestFixture from "../../slicer/fixtures/slice-request.json"
import probeFixture from "../fixtures/probe.json"
import {
  decodeProbeResult,
  decodeSliceProgress,
  decodeSliceRequest,
  type JsonValue,
  type SliceRequest,
} from "../src/slicer/protocol.ts"

const BYTES = { "model-480": 1, "model-720": 2, view: 3 }

describe("decodeSliceRequest", () => {
  it("decodes the slicer's committed request fixture with the worker's copy of the protocol", () => {
    const decoded: SliceRequest | null = decodeSliceRequest(sliceRequestFixture)
    expect(decoded).toEqual(sliceRequestFixture)
    expect(decoded?.crop).toEqual({ x: 0, y: 0, width: 400, height: 60 })
    expect(decoded?.windows.map((window) => Object.keys(window.puts).toSorted())).toEqual([
      ["model-480", "model-720", "view"],
    ])
  })

  it("refuses a window without a view put", () => {
    const [window] = sliceRequestFixture.windows
    const puts = { "model-480": "a", "model-720": "b" }
    expect(decodeSliceRequest({ ...sliceRequestFixture, windows: [{ ...window, puts }] })).toBeNull()
  })
})

describe("decodeProbeResult", () => {
  it("decodes the committed probe fixture", () => {
    expect(decodeProbeResult(probeFixture)).toEqual(probeFixture)
  })

  it.each<[string, JsonValue]>([
    ["a missing frame", { durationMs: 80000, width: 854, height: 480 }],
    ["a zero width", { ...probeFixture, width: 0 }],
    ["a fractional duration", { ...probeFixture, durationMs: 1.5 }],
    ["an array", [probeFixture]],
  ])("refuses %s", (_, value) => {
    expect(decodeProbeResult(value)).toBeNull()
  })
})

describe("decodeSliceProgress", () => {
  it.each<[string, JsonValue]>([
    ["a clip", { kind: "clip", index: 4, bytes: BYTES }],
    ["a failure", { kind: "failed", index: 4, reason: "encode failed" }],
    ["done", { kind: "done" }],
  ])("decodes %s", (_, value) => {
    expect(decodeSliceProgress(value)).toEqual(value)
  })

  it.each<[string, JsonValue]>([
    ["an unknown kind", { kind: "started" }],
    ["a clip missing a rendition size", { kind: "clip", index: 0, bytes: { "model-480": 1, view: 3 } }],
    ["a clip with a negative index", { kind: "clip", index: -1, bytes: BYTES }],
    ["a failure without a reason", { kind: "failed", index: 0 }],
    ["a string", "done"],
    ["null", null],
  ])("refuses %s", (_, value) => {
    expect(decodeSliceProgress(value)).toBeNull()
  })
})
