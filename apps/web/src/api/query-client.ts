import { ServiceUnavailable } from "@strix/contracts"
import { QueryClient } from "@tanstack/react-query"
import { Unexpected } from "./errors.ts"

const STALE_MS = 5_000
const MAX_RETRIES = 3
const SERVER_ERROR = 500

const isTransient = (error: Error) =>
  error instanceof ServiceUnavailable ||
  (error instanceof Unexpected && error.status !== null && error.status >= SERVER_ERROR)

export const retryTransient = (failureCount: number, error: Error) => failureCount < MAX_RETRIES && isTransient(error)

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_MS, refetchOnWindowFocus: true, retry: retryTransient },
    },
  })
