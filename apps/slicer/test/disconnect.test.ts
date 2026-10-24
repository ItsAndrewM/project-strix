import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { abortOnDisconnect } from "../src/disconnect.ts"

const response = (writableFinished: boolean) => Object.assign(new EventEmitter(), { writableFinished })

describe("abortOnDisconnect", () => {
  it("fires when the connection closes before the response finished", () => {
    const res = response(false)
    const signal = abortOnDisconnect(res)
    expect(signal.aborted).toBe(false)
    res.emit("close")
    expect(signal.aborted).toBe(true)
  })

  it("stays quiet when the response finished before the connection closed", () => {
    const res = response(true)
    const signal = abortOnDisconnect(res)
    res.emit("close")
    expect(signal.aborted).toBe(false)
  })
})
