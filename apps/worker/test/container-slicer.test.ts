import { describe, expect, it } from "vitest"
import type { ProbeResult, SliceProgress, SliceRequest } from "../src/slicer/protocol.ts"
import { slicerOver } from "../src/slicer/slicer-container.ts"

const REQUEST: SliceRequest = {
  source: "https://acct.r2.cloudflarestorage.com/strix/originals/g.mp4",
  crop: null,
  windows: [],
}

const PROBE: ProbeResult = { durationMs: 80_000, width: 854, height: 480, frameJpegBase64: "/9j/2Q==" }

const clipLine = (index: number): SliceProgress => ({
  kind: "clip",
  index,
  bytes: { "model-480": 10 + index, "model-720": 20 + index, view: 30 + index },
})

const DONE: SliceProgress = { kind: "done" }

const ndjson = (lines: readonly SliceProgress[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("")

const streamed = (chunks: readonly string[], status = 200) => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } })
}

const fakeContainer = (response: Response) => {
  const requests: Request[] = []
  const send = async (request: Request) => {
    requests.push(request)
    return response
  }
  return { requests, slicer: slicerOver(send) }
}

const collect = () => {
  const lines: SliceProgress[] = []
  const onProgress = async (progress: SliceProgress) => {
    lines.push(progress)
  }
  return { lines, onProgress }
}

describe("slicerOver slice", () => {
  it("posts the request as JSON to /slice", async () => {
    const { requests, slicer } = fakeContainer(streamed([ndjson([DONE])]))
    await slicer.slice(REQUEST, collect().onProgress)

    const [request] = requests
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("http://slicer/slice")
    expect(request?.headers.get("content-type")).toBe("application/json")
    expect(await request?.json()).toEqual(REQUEST)
  })

  it("hands each clip line to onProgress in order and resolves on done", async () => {
    const { slicer } = fakeContainer(streamed([ndjson([clipLine(0), clipLine(1), clipLine(2), DONE])]))
    const { lines, onProgress } = collect()
    await slicer.slice(REQUEST, onProgress)

    expect(lines).toEqual([clipLine(0), clipLine(1), clipLine(2), DONE])
  })

  it("reassembles lines split across chunks and skips blank lines", async () => {
    const text = `\n${ndjson([clipLine(0), clipLine(1)])}\n${ndjson([DONE])}`
    const { slicer } = fakeContainer(streamed([text.slice(0, 7), text.slice(7, 60), text.slice(60)]))
    const { lines, onProgress } = collect()
    await slicer.slice(REQUEST, onProgress)

    expect(lines).toEqual([clipLine(0), clipLine(1), DONE])
  })

  it("passes a failed line through", async () => {
    const failed: SliceProgress = { kind: "failed", index: 1, reason: "upload of view failed with 403" }
    const { slicer } = fakeContainer(streamed([ndjson([clipLine(0), failed, DONE])]))
    const { lines, onProgress } = collect()
    await slicer.slice(REQUEST, onProgress)

    expect(lines).toEqual([clipLine(0), failed, DONE])
  })

  it("rejects a stream that ends without done, after reporting what arrived", async () => {
    const { slicer } = fakeContainer(streamed([ndjson([clipLine(0), clipLine(1)])]))
    const { lines, onProgress } = collect()

    await expect(slicer.slice(REQUEST, onProgress)).rejects.toThrow("slice stream ended without done")
    expect(lines).toEqual([clipLine(0), clipLine(1)])
  })

  it("accepts a final done line without a trailing newline", async () => {
    const { slicer } = fakeContainer(streamed([ndjson([clipLine(0)]), JSON.stringify(DONE)]))
    const { lines, onProgress } = collect()
    await slicer.slice(REQUEST, onProgress)

    expect(lines).toEqual([clipLine(0), DONE])
  })

  it("rejects a final line cut off before its newline", async () => {
    const { slicer } = fakeContainer(streamed([ndjson([clipLine(0)]), '{"kind":"do']))
    await expect(slicer.slice(REQUEST, collect().onProgress)).rejects.toThrow(/do/)
  })

  it("rejects a line that is not slice progress", async () => {
    const { slicer } = fakeContainer(streamed(['{"kind":"started"}\n', ndjson([DONE])]))
    await expect(slicer.slice(REQUEST, collect().onProgress)).rejects.toThrow(/started/)
  })

  it("rejects a line that is not JSON", async () => {
    const { slicer } = fakeContainer(streamed(["ffmpeg exploded\n", ndjson([DONE])]))
    await expect(slicer.slice(REQUEST, collect().onProgress)).rejects.toThrow(/ffmpeg exploded/)
  })

  it("rejects a non-2xx answer with its body", async () => {
    const { slicer } = fakeContainer(new Response('{"error":"expected { source, crop, windows }"}', { status: 400 }))
    await expect(slicer.slice(REQUEST, collect().onProgress)).rejects.toThrow(
      /400.*expected \{ source, crop, windows \}/,
    )
  })
})

describe("slicerOver probe", () => {
  it("posts the request to /probe and decodes the result", async () => {
    const { requests, slicer } = fakeContainer(Response.json(PROBE))
    await expect(slicer.probe({ source: "https://x/y.mp4", frameAtMs: 1000 })).resolves.toEqual(PROBE)

    const [request] = requests
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("http://slicer/probe")
    expect(request?.headers.get("content-type")).toBe("application/json")
    expect(await request?.json()).toEqual({ source: "https://x/y.mp4", frameAtMs: 1000 })
  })

  it("rejects a non-2xx answer with its body", async () => {
    const { slicer } = fakeContainer(new Response('{"error":"no frame at 1000 ms"}', { status: 500 }))
    await expect(slicer.probe({ source: "https://x/y.mp4", frameAtMs: 1000 })).rejects.toThrow(/500.*no frame/)
  })

  it("rejects a result that is not a ProbeResult", async () => {
    const { slicer } = fakeContainer(Response.json({ durationMs: 80_000 }))
    await expect(slicer.probe({ source: "https://x/y.mp4", frameAtMs: 1000 })).rejects.toThrow(/probe result/)
  })
})
