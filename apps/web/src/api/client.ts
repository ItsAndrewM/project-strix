import { Api } from "@strix/contracts"
import { Effect, type Schema } from "effect"
import { FetchHttpClient, type HttpClientError } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { classify } from "./errors.ts"

export type ApiClient = HttpApiClient.ForApi<typeof Api>

export interface ApiOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
}

const REQUEST_INIT: RequestInit = { credentials: "same-origin" }

export const connectApi = ({ baseUrl, fetch }: ApiOptions = {}) => {
  const request = <A, E>(
    call: (client: ApiClient) => Effect.Effect<A, E | HttpClientError.HttpClientError | Schema.SchemaError>,
  ): Promise<A> => {
    const program = HttpApiClient.make(Api, { baseUrl }).pipe(
      Effect.flatMap(call),
      Effect.mapError(classify),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, REQUEST_INIT),
    )
    return Effect.runPromise(
      fetch === undefined ? program : Effect.provideService(program, FetchHttpClient.Fetch, fetch),
    )
  }
  return { request }
}

export type StrixApi = ReturnType<typeof connectApi>
