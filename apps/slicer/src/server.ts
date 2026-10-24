import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { text } from "node:stream/consumers"
import { abortOnDisconnect } from "./disconnect.ts"
import { reasonOf, runProbe, runSlice } from "./jobs.ts"
import {
  decodeProbeRequest,
  decodeSliceRequest,
  type JsonValue,
  type ProbeResult,
  type SliceProgress,
} from "./protocol.ts"

const PORT = 8080

const sendJson = (res: ServerResponse, status: number, body: ProbeResult | { error: string }): void => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const readJson = async (req: IncomingMessage): Promise<JsonValue> => {
  try {
    const body: JsonValue = JSON.parse(await text(req))
    return body
  } catch {
    return null
  }
}

const probe = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const request = decodeProbeRequest(await readJson(req))
  if (request === null) return sendJson(res, 400, { error: "expected { source, frameAtMs }" })
  try {
    sendJson(res, 200, await runProbe(request))
  } catch (cause) {
    sendJson(res, 500, { error: reasonOf(cause) })
  }
}

const slice = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const request = decodeSliceRequest(await readJson(req))
  if (request === null) return sendJson(res, 400, { error: "expected { source, crop, windows }" })
  const emit = (progress: SliceProgress): void => {
    if (!res.headersSent) res.writeHead(200, { "content-type": "application/x-ndjson" })
    res.write(`${JSON.stringify(progress)}\n`)
  }
  try {
    await runSlice(request, emit, abortOnDisconnect(res))
    res.end()
  } catch (cause) {
    if (res.headersSent) res.end()
    else sendJson(res, 500, { error: reasonOf(cause) })
  }
}

const health = async (_: IncomingMessage, res: ServerResponse): Promise<void> => {
  res.writeHead(200, { "content-type": "text/plain" })
  res.end("ok")
}

const ROUTES = new Map([
  ["GET /health", health],
  ["POST /probe", probe],
  ["POST /slice", slice],
])

const server = createServer((req, res) => {
  const route = `${req.method} ${URL.parse(req.url ?? "/", "http://slicer")?.pathname}`
  const handler = ROUTES.get(route)
  if (handler === undefined) return sendJson(res, 404, { error: `no route for ${req.method} ${req.url}` })
  handler(req, res).catch((cause) => {
    if (res.headersSent) res.end()
    else sendJson(res, 500, { error: reasonOf(cause) })
  })
})

server.listen(PORT)
process.on("SIGTERM", () => server.close(() => process.exit(0)))
