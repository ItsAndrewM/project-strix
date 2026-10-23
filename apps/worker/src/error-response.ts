import { InvalidInput, NotFound, ServiceUnavailable, Unauthorized } from "@strix/contracts"
import { Schema } from "effect"

const WorkerError = Schema.Union([Unauthorized, InvalidInput, NotFound, ServiceUnavailable])
type WorkerError = typeof WorkerError.Type

const STATUS = { Unauthorized: 401, InvalidInput: 400, NotFound: 404, ServiceUnavailable: 503 } as const

const encode = Schema.encodeSync(Schema.toCodecJson(WorkerError))

export const errorResponse = (error: WorkerError): Response =>
  Response.json(encode(error), { status: STATUS[error._tag], headers: { "cache-control": "no-store" } })
