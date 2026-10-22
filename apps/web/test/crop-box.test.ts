import { describe, expect, it } from "vitest"
import { initialRect, moveRect, resizeRect, toSource } from "../src/features/game/crop-geometry.ts"

const RENDERED = { width: 640, height: 360 }
const NATURAL = { width: 1920, height: 1080 }

describe("toSource", () => {
  it("scales a displayed rectangle up to source pixels", () => {
    expect(toSource({ x: 32, y: 18, width: 256, height: 43.2 }, RENDERED, NATURAL)).toEqual({
      x: 96,
      y: 54,
      width: 768,
      height: 130,
    })
  })

  it("rounds to whole pixels", () => {
    expect(toSource({ x: 10.2, y: 10.4, width: 100.1, height: 20.3 }, RENDERED, NATURAL)).toEqual({
      x: 31,
      y: 31,
      width: 300,
      height: 61,
    })
  })

  it("clamps a rectangle that hangs off the image to the image", () => {
    expect(toSource({ x: -10, y: 300, width: 700, height: 100 }, RENDERED, NATURAL)).toEqual({
      x: 0,
      y: 900,
      width: 1920,
      height: 180,
    })
  })
})

describe("initialRect", () => {
  it("starts 5% in from the top left, 40% wide and 12% tall", () => {
    expect(initialRect(RENDERED)).toEqual({ x: 32, y: 18, width: 256, height: 43.2 })
  })
})

describe("moveRect", () => {
  it("moves the box and keeps it inside the image", () => {
    const rect = { x: 32, y: 18, width: 256, height: 40 }
    expect(moveRect(rect, { dx: 10, dy: 5 }, RENDERED)).toEqual({ x: 42, y: 23, width: 256, height: 40 })
    expect(moveRect(rect, { dx: 1_000, dy: -1_000 }, RENDERED)).toEqual({ x: 384, y: 0, width: 256, height: 40 })
  })
})

describe("resizeRect", () => {
  it("grows from the bottom right, never past the image or below a minimum size", () => {
    const rect = { x: 32, y: 18, width: 256, height: 40 }
    expect(resizeRect(rect, { dx: 20, dy: 10 }, RENDERED)).toEqual({ x: 32, y: 18, width: 276, height: 50 })
    expect(resizeRect(rect, { dx: 1_000, dy: 1_000 }, RENDERED)).toEqual({ x: 32, y: 18, width: 608, height: 342 })
    expect(resizeRect(rect, { dx: -1_000, dy: -1_000 }, RENDERED)).toEqual({ x: 32, y: 18, width: 16, height: 16 })
  })
})
