import { ServiceUnavailable } from "@strix/contracts"
import { Data, Schema } from "effect"
import { HttpClientError } from "effect/http"

export class Unexpected extends Data.TaggedError("Unexpected")<{ readonly status: number | null }> {}

const SERVICE_UNAVAILABLE = 503

const statusOf = ({ reason }: HttpClientError.HttpClientError): number | null => {
  switch (reason._tag) {
    case "StatusCodeError":
    case "DecodeError":
    case "EmptyBodyError":
      return reason.response.status
    default:
      return null
  }
}

const fromHttpClient = (error: HttpClientError.HttpClientError) => {
  const status = statusOf(error)
  if (status === SERVICE_UNAVAILABLE) return new ServiceUnavailable()
  return new Unexpected({ status })
}

export const classify = <E>(error: E | HttpClientError.HttpClientError | Schema.SchemaError) => {
  if (error instanceof HttpClientError.HttpClientError) return fromHttpClient(error)
  if (error instanceof Schema.SchemaError) return new Unexpected({ status: null })
  return error
}
