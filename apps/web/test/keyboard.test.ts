import { describe, expect, it } from "vitest"
import { keyFor } from "../src/features/game/keyboard.ts"

describe("keyFor", () => {
  it.each([
    ["j", "next"],
    ["k", "prev"],
    ["ArrowRight", "clipNext"],
    ["ArrowLeft", "clipPrev"],
    [" ", "playPause"],
  ] as const)("maps %j to %s", (key, action) => {
    expect(keyFor(key)).toBe(action)
  })

  it.each(["x", "J", "Enter", "ArrowUp"])("ignores %j", (key) => {
    expect(keyFor(key)).toBeNull()
  })
})
