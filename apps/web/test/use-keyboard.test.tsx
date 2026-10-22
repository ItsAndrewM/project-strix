import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type KeyHandlers, useKeyboard } from "../src/features/game/keyboard.ts"

const handlers = () =>
  ({
    next: vi.fn<() => void>(),
    prev: vi.fn<() => void>(),
    clipNext: vi.fn<() => void>(),
    clipPrev: vi.fn<() => void>(),
    playPause: vi.fn<() => void>(),
  }) satisfies KeyHandlers

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("useKeyboard", () => {
  it("runs the handler a key maps to and keeps the browser from also acting on it", () => {
    const keys = handlers()
    renderHook(() => useKeyboard(keys))
    const event = press(document.body, " ")
    press(document.body, "j")
    expect([keys.playPause.mock.calls.length, keys.next.mock.calls.length, event.defaultPrevented]).toEqual([
      1,
      1,
      true,
    ])
  })

  it.each(["input", "textarea", "select"])("ignores keys typed into a %s", (tag) => {
    const keys = handlers()
    renderHook(() => useKeyboard(keys))
    const field = document.body.appendChild(document.createElement(tag))
    const event = press(field, "j")
    expect([keys.next.mock.calls.length, event.defaultPrevented]).toEqual([0, false])
  })

  it("leaves shortcuts with a modifier to the browser", () => {
    const keys = handlers()
    renderHook(() => useKeyboard(keys))
    press(document.body, "ArrowLeft", { metaKey: true })
    expect(keys.clipPrev).not.toHaveBeenCalled()
  })

  it("stops listening once unmounted", () => {
    const keys = handlers()
    const { unmount } = renderHook(() => useKeyboard(keys))
    unmount()
    press(document.body, "k")
    expect(keys.prev).not.toHaveBeenCalled()
  })
})
