/**
 * The game's live socket: the Worker names what changed and the dashboard refetches it.
 * A drop reconnects with jittered backoff, and a ping left unanswered for a whole beat counts as a drop.
 * Changes missed while disconnected are unknowable, so a reconnect after a drop refreshes everything.
 */
import { type Changed, ChangedMessage, HEARTBEAT, socketPath } from "@strix/contracts"
import { Option, Schema } from "effect"

export interface LiveSocket extends EventTarget {
  send(data: string): void
  close(): void
}

export interface LiveOptions {
  readonly open: () => LiveSocket
  readonly onChanged: (changed: ReadonlyArray<Changed>) => void
  readonly onStale: () => void
  readonly random?: () => number
}

export interface Live {
  readonly stop: () => void
}

export const HEARTBEAT_MS = 30_000
const FIRST_RETRY_MS = 1_000
const LAST_RETRY_MS = 30_000

export const retryDelay = (attempt: number, random: () => number) =>
  Math.min(LAST_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt) * (0.5 + random() / 2)

export const socketUrl = ({ protocol, host }: Pick<Location, "protocol" | "host">, gameId: string) =>
  `${protocol === "https:" ? "wss:" : "ws:"}//${host}${socketPath(gameId)}`

const decodeChanged = Schema.decodeUnknownOption(Schema.fromJsonString(ChangedMessage))

export const startLive = ({ open, onChanged, onStale, random = Math.random }: LiveOptions): Live => {
  let socket: LiveSocket | null = null
  let attempt = 0
  let lost = false
  let stopped = false
  let awaitingPong = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const drop = () => {
    clearInterval(heartbeat)
    socket = null
    lost = true
  }

  const reconnectLater = () => {
    if (stopped) return
    retry = setTimeout(connect, retryDelay(attempt, random))
    attempt += 1
  }

  const beat = (current: LiveSocket) => {
    if (!awaitingPong) {
      awaitingPong = true
      current.send(HEARTBEAT.ping)
      return
    }
    drop()
    current.close()
    reconnectLater()
  }

  const opens = (current: LiveSocket) => {
    attempt = 0
    awaitingPong = false
    if (lost) onStale()
    heartbeat = setInterval(() => beat(current), HEARTBEAT_MS)
  }

  const hears = (data: string) => {
    if (data === HEARTBEAT.pong) awaitingPong = false
    else Option.match(decodeChanged(data), { onNone: onStale, onSome: ({ changed }) => onChanged(changed) })
  }

  const closes = () => {
    drop()
    reconnectLater()
  }

  function connect() {
    const current = open()
    socket = current
    current.addEventListener("open", () => socket === current && opens(current))
    current.addEventListener("message", (event) => {
      if (socket === current && event instanceof MessageEvent) hears(String(event.data))
    })
    current.addEventListener("close", () => socket === current && closes())
  }

  connect()
  return {
    stop: () => {
      stopped = true
      clearTimeout(retry)
      const current = socket
      drop()
      current?.close()
    },
  }
}
