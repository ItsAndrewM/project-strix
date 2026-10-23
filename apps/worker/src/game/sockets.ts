import { type Changed, ChangedMessage, HEARTBEAT, Unauthorized } from "@strix/contracts"
import { Schema } from "effect"
import { errorResponse } from "../error-response.ts"
import { logRefusal, routeOf } from "../logs.ts"

export type Broadcast = (changed: ReadonlyArray<Changed>) => void

const NO_STORE = { "cache-control": "no-store" }

const messageJson = Schema.encodeSync(Schema.fromJsonString(ChangedMessage))

export const heartbeat = () => new WebSocketRequestResponsePair(HEARTBEAT.ping, HEARTBEAT.pong)

const upgradeRequired = () => new Response(null, { status: 426, headers: { upgrade: "websocket", ...NO_STORE } })

const foreignOrigin = () => new Response(null, { status: 403, headers: NO_STORE })

export const acceptSocket = (ctx: DurableObjectState, request: Request): Response => {
  const route = routeOf(request.method, request.url)
  if (request.headers.get("x-strix-email") === null) {
    logRefusal(route, "no-forwarded-email")
    return errorResponse(new Unauthorized())
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    logRefusal(route, "foreign-origin")
    return foreignOrigin()
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return upgradeRequired()
  const { 0: client, 1: server } = new WebSocketPair()
  ctx.acceptWebSocket(server)
  return new Response(null, { status: 101, webSocket: client, headers: NO_STORE })
}

export const broadcastTo =
  (ctx: DurableObjectState): Broadcast =>
  (changed) => {
    const message = messageJson({ changed })
    for (const socket of ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }

const NO_CODE_RECEIVED = 1005
const CLOSED_WITHOUT_FRAME = 1006

export const answerClose = (socket: WebSocket, code: number, reason: string): void => {
  if (socket.readyState !== WebSocket.CLOSING) return
  if (code === NO_CODE_RECEIVED || code === CLOSED_WITHOUT_FRAME) socket.close()
  else socket.close(code, reason)
}
