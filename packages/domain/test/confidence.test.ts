import { describe, expect, it } from "vitest"
import { argmax, percentOf } from "../src/index.ts"

describe("percentOf", () => {
  it("rounds to a percentage", () => {
    expect(percentOf(0.715)).toBe(72)
    expect(percentOf(0.5)).toBe(50)
  })

  it("clamps up to 1", () => {
    expect(percentOf(0)).toBe(1)
    expect(percentOf(0.004)).toBe(1)
    expect(percentOf(-0.3)).toBe(1)
  })

  it("clamps down to 100", () => {
    expect(percentOf(1)).toBe(100)
    expect(percentOf(1.4)).toBe(100)
  })
})

describe("argmax", () => {
  it("returns the most probable key", () => {
    const probabilities = new Map([
      ["a", 0.2],
      ["b", 0.7],
      ["c", 0.1],
    ])
    expect(argmax(probabilities)).toEqual({ key: "b", probability: 0.7 })
  })

  it("keeps the first key on a tie", () => {
    const probabilities = new Map([
      ["a", 0.5],
      ["b", 0.5],
    ])
    expect(argmax(probabilities).key).toBe("a")
  })

  it("throws a RangeError on an empty map", () => {
    expect(() => argmax(new Map())).toThrow(RangeError)
  })
})
