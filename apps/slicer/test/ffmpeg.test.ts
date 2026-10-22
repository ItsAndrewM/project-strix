import { describe, expect, it } from "vitest"
import { FULL_CAPS, frameArgs, HALF_CAPS, outputPath, probeArgs, readProbe, sliceArgs } from "../src/ffmpeg.ts"
import type { Rendition } from "../src/protocol.ts"

const SOURCE = "https://x/y.mp4"
const WINDOW = { index: 3, startMs: 75_000, durationMs: 30_000 }
const CROP = { x: 0, y: 0, width: 400, height: 60 }
const BLIND = "drawbox=x=0:y=0:w=400:h=60:color=black:t=fill"

const valueAfter = (args: readonly string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

const outputOptions = (args: readonly string[], rendition: Rendition): readonly string[] => {
  const path = outputPath("/tmp/w3", 3, rendition)
  const end = args.indexOf(path)
  const start = args.lastIndexOf("-map", args.lastIndexOf("-map", end) - 1)
  return args.slice(start, end + 1)
}

describe("sliceArgs", () => {
  const args = sliceArgs(SOURCE, WINDOW, CROP, "/tmp/w3")
  const filter = valueAfter(args, "-filter_complex") ?? ""

  it("fast-seeks to the window start before the input and bounds the duration", () => {
    expect(valueAfter(args, "-ss")).toBe("75")
    expect(valueAfter(args, "-t")).toBe("30")
    expect(valueAfter(args, "-i")).toBe(SOURCE)
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-t"))
    expect(args.indexOf("-t")).toBeLessThan(args.indexOf("-i"))
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("-filter_complex"))
  })

  it("splits the video three ways and blinds the crop on both model branches only", () => {
    expect(filter).toContain("[0:v]split=3")
    expect(filter.split(BLIND)).toHaveLength(3)
    expect(filter).toContain(`[v480]${BLIND},scale=854:-2[m480]`)
    expect(filter).toContain(`[v720]${BLIND},scale=1280:-2[m720]`)
    expect(filter).toContain("[vview]scale=854:-2[view]")
  })

  it("leaves every branch uncovered without a crop", () => {
    const uncropped = valueAfter(sliceArgs(SOURCE, WINDOW, null, "/tmp/w3"), "-filter_complex") ?? ""
    expect(uncropped).toContain("split=3")
    expect(uncropped).not.toContain("drawbox")
    expect(uncropped).toContain("[v480]scale=854:-2[m480]")
    expect(uncropped).toContain("[v720]scale=1280:-2[m720]")
  })

  it("writes three faststart outputs named by window index", () => {
    expect(outputPath("/tmp/w3", 3, "model-480")).toBe("/tmp/w3/3-model-480.mp4")
    expect(args.at(-1)).toBe("/tmp/w3/3-view.mp4")
    expect(args.filter((arg) => arg.startsWith("/tmp/w3/"))).toEqual([
      "/tmp/w3/3-model-480.mp4",
      "/tmp/w3/3-model-720.mp4",
      "/tmp/w3/3-view.mp4",
    ])
    expect(args.filter((arg) => arg === "+faststart")).toHaveLength(3)
  })

  it.each([
    ["model-480", "[m480]", "1M", "2M", "64k"],
    ["model-720", "[m720]", "2M", "4M", "64k"],
    ["view", "[view]", "1M", "2M", "96k"],
  ] as const)("encodes %s as capped H.264 and AAC", (rendition, label, maxrate, bufsize, audio) => {
    const options = outputOptions(args, rendition)
    expect(options.slice(0, 4)).toEqual(["-map", label, "-map", "0:a?"])
    expect(valueAfter(options, "-c:v")).toBe("libx264")
    expect(valueAfter(options, "-preset")).toBe("veryfast")
    expect(valueAfter(options, "-maxrate")).toBe(maxrate)
    expect(valueAfter(options, "-bufsize")).toBe(bufsize)
    expect(valueAfter(options, "-c:a")).toBe("aac")
    expect(valueAfter(options, "-b:a")).toBe(audio)
    expect(valueAfter(options, "-movflags")).toBe("+faststart")
  })

  it("halves every video cap for the re-encode", () => {
    const retry = sliceArgs(SOURCE, WINDOW, CROP, "/tmp/w3", HALF_CAPS)
    const maxrates = retry.flatMap((arg, at) => (arg === "-maxrate" ? [retry[at + 1]] : []))
    expect(maxrates).toEqual(["500k", "1M", "500k"])
    expect(FULL_CAPS["model-720"]).toBe(HALF_CAPS["model-720"] * 2)
  })

  it("keeps fractional window starts in seconds", () => {
    const fractional = sliceArgs(SOURCE, { index: 0, startMs: 1500, durationMs: 30_000 }, null, "/tmp/w0")
    expect(valueAfter(fractional, "-ss")).toBe("1.5")
  })
})

describe("probeArgs", () => {
  it("asks ffprobe for quiet JSON format and streams", () => {
    expect(probeArgs(SOURCE)).toEqual(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", SOURCE])
  })
})

describe("frameArgs", () => {
  it("seeks to the offset and pipes one JPEG to stdout", () => {
    const args = frameArgs(SOURCE, 1500)
    expect(args.slice(args.indexOf("-ss"))).toEqual([
      "-ss",
      "1.5",
      "-i",
      SOURCE,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ])
  })
})

describe("readProbe", () => {
  const probe = {
    streams: [
      { codec_type: "audio", sample_rate: "48000" },
      { codec_type: "video", width: 1920, height: 1080 },
    ],
    format: { duration: "80.123456" },
  }

  it("reads the duration in milliseconds and the first video stream's size", () => {
    expect(readProbe(probe)).toEqual({ durationMs: 80_123, width: 1920, height: 1080 })
  })

  it.each([
    ["no video stream", { ...probe, streams: [{ codec_type: "audio" }] }],
    ["no duration", { ...probe, format: {} }],
    ["a duration that is not a number", { ...probe, format: { duration: "N/A" } }],
    ["no streams", { format: probe.format }],
    ["output that is not an object", []],
  ])("returns null for %s", (_, output) => {
    expect(readProbe(output)).toBeNull()
  })
})
