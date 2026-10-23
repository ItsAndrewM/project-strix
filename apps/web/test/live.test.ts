import { type Changed, HEARTBEAT } from "@strix/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HEARTBEAT_MS, type LiveSocket, retryDelay, socketUrl, startLive } from "../src/api/live.ts"

class FakeSocket extends EventTarget implements LiveSocket {
  readonly sent: string[] = []
  closed = false

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  opens() {
    this.dispatchEvent(new Event("open"))
  }

  hears(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }))
  }

  closes() {
    this.dispatchEvent(new Event("close"))
  }
}

const FIRST_RETRY_AT_MOST = 1_000

const live = () => {
  const sockets: FakeSocket[] = []
  const changed: Array<ReadonlyArray<Changed>> = []
  let staleCount = 0
  const connection = startLive({
    open: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    onChanged: (kinds) => {
      changed.push(kinds)
    },
    onStale: () => {
      staleCount += 1
    },
    random: () => 1,
  })
  const latest = () => {
    const socket = sockets.at(-1)
    if (socket === undefined) throw new Error("no socket was opened")
    return socket
  }
  return { connection, sockets, changed, latest, stale: () => staleCount }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("socketUrl", () => {
  it("opens the game's socket on the page's own origin, wss: when the page is https:", () => {
    expect(socketUrl({ protocol: "https:", host: "strix.example.test" }, "g1")).toBe(
      "wss://strix.example.test/api/games/g1/ws",
    )
    expect(socketUrl({ protocol: "http:", host: "localhost:5173" }, "g1")).toBe("ws://localhost:5173/api/games/g1/ws")
  })
})

describe("retryDelay", () => {
  it("waits 1 s after the first failure, doubling to at most 30 s, with up to half taken off at random", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map((attempt) => retryDelay(attempt, () => 1))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ])
    expect(retryDelay(0, () => 0)).toBe(500)
  })
})

describe("startLive", () => {
  it("passes on what a changed message names", () => {
    const { latest, changed, stale } = live()
    latest().opens()
    latest().hears('{"changed":["events"]}')
    expect(changed).toEqual([["events"]])
    expect(stale()).toBe(0)
  })

  it("refreshes everything when a message isn't a changed list it can read", () => {
    const { latest, changed, stale } = live()
    latest().opens()
    latest().hears('{"changed":["weather"]}')
    expect(changed).toEqual([])
    expect(stale()).toBe(1)
  })

  it("pings every 30 s, and a pong keeps the socket without reporting a change", () => {
    const { latest, sockets, changed, stale } = live()
    latest().opens()
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(latest().sent).toEqual([HEARTBEAT.ping])
    latest().hears(HEARTBEAT.pong)
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(latest().sent).toEqual([HEARTBEAT.ping, HEARTBEAT.ping])
    expect([sockets.length, changed, stale()]).toEqual([1, [], 0])
  })

  it("gives up on a socket whose ping went unanswered for a whole beat, and opens another", () => {
    const { latest, sockets } = live()
    const first = latest()
    first.opens()
    vi.advanceTimersByTime(2 * HEARTBEAT_MS)
    expect(first.closed).toBe(true)
    vi.advanceTimersByTime(FIRST_RETRY_AT_MOST)
    expect(sockets).toHaveLength(2)
    first.closes()
    vi.advanceTimersByTime(30_000)
    expect(sockets).toHaveLength(2)
  })

  it("reconnects after a drop, waiting longer after each failure, and refreshes everything once it's back", () => {
    const { latest, sockets, stale } = live()
    latest().opens()
    latest().closes()
    vi.advanceTimersByTime(FIRST_RETRY_AT_MOST - 1)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    latest().closes()
    vi.advanceTimersByTime(2_000)
    expect(sockets).toHaveLength(3)
    expect(stale()).toBe(0)
    latest().opens()
    expect(stale()).toBe(1)
  })

  it("closes its socket when stopped and never reconnects", () => {
    const { connection, latest, sockets } = live()
    latest().opens()
    connection.stop()
    expect(latest().closed).toBe(true)
    latest().closes()
    vi.advanceTimersByTime(10 * 30_000)
    expect(sockets).toHaveLength(1)
  })

  it("opens nothing when stopped while waiting to retry", () => {
    const { connection, latest, sockets } = live()
    latest().opens()
    latest().closes()
    connection.stop()
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })
})
