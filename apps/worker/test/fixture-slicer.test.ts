import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import probeFixture from "../fixtures/probe.json"
import { fixtureSlicer } from "../src/slicer/fixture-slicer.ts"
import { RENDITIONS, type SliceProgress, type SliceRequest, type SliceWindow } from "../src/slicer/protocol.ts"
import { slicerFor } from "../src/slicer/slicer.ts"

const windowFor = (gameId: string, index: number): SliceWindow => ({
  index,
  startMs: index * 30_000,
  durationMs: 30_000,
  puts: {
    "model-480": `r2://clips/${gameId}/${index}/model-480.mp4`,
    "model-720": `r2://clips/${gameId}/${index}/model-720.mp4`,
    view: `r2://clips/${gameId}/${index}/view.mp4`,
  },
})

const requestFor = (gameId: string, indexes: readonly number[]): SliceRequest => ({
  source: `r2://originals/${gameId}.mp4`,
  crop: null,
  windows: indexes.map((index) => windowFor(gameId, index)),
})

const collect = () => {
  const lines: SliceProgress[] = []
  const onProgress = async (progress: SliceProgress) => {
    lines.push(progress)
  }
  return { lines, onProgress }
}

const keysUnder = async (prefix: string) =>
  (await env.BUCKET.list({ prefix })).objects.map((object) => object.key).toSorted()

describe("fixtureSlicer", () => {
  it("probes to the committed probe fixture", async () => {
    const result = await fixtureSlicer(env.BUCKET).probe({ source: "r2://originals/g.mp4", frameAtMs: 0 })
    expect(result).toEqual(probeFixture)
    expect(result.durationMs).toBe(75_000)
    const jpeg = Uint8Array.from(atob(result.frameJpegBase64), (char) => char.charCodeAt(0))
    expect([jpeg[0], jpeg[1], jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })

  it("writes three renditions per window, emitting a clip line each and then done", async () => {
    const { lines, onProgress } = collect()
    await fixtureSlicer(env.BUCKET).slice(requestFor("three", [0, 1, 2]), onProgress)

    expect(lines.map((line) => line.kind)).toEqual(["clip", "clip", "clip", "done"])
    expect(lines.slice(0, 3).map((line) => (line.kind === "clip" ? line.index : null))).toEqual([0, 1, 2])
    expect(await keysUnder("clips/three/")).toEqual(
      [0, 1, 2].flatMap((index) => RENDITIONS.map((rendition) => `clips/three/${index}/${rendition}.mp4`)),
    )
  })

  it("reports the stored size of each rendition and stores them as video/mp4", async () => {
    const { lines, onProgress } = collect()
    await fixtureSlicer(env.BUCKET).slice(requestFor("sizes", [0]), onProgress)

    const [clip] = lines
    if (clip?.kind !== "clip") throw new Error(`expected a clip line, got ${JSON.stringify(clip)}`)
    for (const rendition of RENDITIONS) {
      const object = await env.BUCKET.head(`clips/sizes/0/${rendition}.mp4`)
      expect(object?.size).toBe(clip.bytes[rendition])
      expect(object?.httpMetadata?.contentType).toBe("video/mp4")
      expect(clip.bytes[rendition]).toBeGreaterThan(0)
    }
    const stored = await env.BUCKET.get("clips/sizes/0/view.mp4")
    const head = new TextDecoder().decode((await stored?.arrayBuffer())?.slice(4, 8))
    expect(head).toBe("ftyp")
  })

  it("cycles the three fixture windows by window index", async () => {
    const { lines, onProgress } = collect()
    await fixtureSlicer(env.BUCKET).slice(requestFor("cycle", [1, 4]), onProgress)

    const [first, second] = lines
    if (first?.kind !== "clip" || second?.kind !== "clip") throw new Error("expected two clip lines")
    expect(second.index).toBe(4)
    expect(second.bytes).toEqual(first.bytes)
  })

  it("refuses put URLs that are not r2://", async () => {
    const { onProgress } = collect()
    const request = requestFor("https", [0])
    const window = windowFor("https", 0)
    const presigned = { ...window, puts: { ...window.puts, view: "https://acct.r2.cloudflarestorage.com/x" } }
    await expect(fixtureSlicer(env.BUCKET).slice({ ...request, windows: [presigned] }, onProgress)).rejects.toThrow(
      /r2:\/\//,
    )
  })
})

describe("slicerFor in the fixture environment", () => {
  it("returns the fixture slicer", async () => {
    const result = await (await slicerFor(env, "g", 0)).probe({ source: "r2://originals/g.mp4", frameAtMs: 0 })
    expect(result).toEqual(probeFixture)
  })

  it("fails the probe when FIXTURES_FAIL_PROBE is set", async () => {
    const slicer = await slicerFor({ ...env, FIXTURES_FAIL_PROBE: "1" }, "g", 0)
    await expect(slicer.probe({ source: "r2://originals/g.mp4", frameAtMs: 0 })).rejects.toThrow("fixture probe failed")
  })

  it("fails the slice after FIXTURES_FAIL_SLICE_AFTER clips", async () => {
    const { lines, onProgress } = collect()
    const slicer = await slicerFor({ ...env, FIXTURES_FAIL_SLICE_AFTER: "2" }, "fail-after", 0)

    await expect(slicer.slice(requestFor("fail-after", [0, 1, 2]), onProgress)).rejects.toThrow(/after 2 clips/)
    expect(lines.map((line) => line.kind)).toEqual(["clip", "clip"])
  })

  it("fails before any clip when FIXTURES_FAIL_SLICE_AFTER is 0", async () => {
    const { lines, onProgress } = collect()
    const slicer = await slicerFor({ ...env, FIXTURES_FAIL_SLICE_AFTER: "0" }, "fail-first", 0)

    await expect(slicer.slice(requestFor("fail-first", [0]), onProgress)).rejects.toThrow(/after 0 clips/)
    expect(lines).toEqual([])
  })

  it("rejects a FIXTURES_FAIL_SLICE_AFTER that is not a count", async () => {
    await expect(slicerFor({ ...env, FIXTURES_FAIL_SLICE_AFTER: "two" }, "g", 0)).rejects.toThrow(
      /FIXTURES_FAIL_SLICE_AFTER/,
    )
  })
})
