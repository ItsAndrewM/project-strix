import { InvalidInput, NotFound, ServiceUnavailable, Unauthorized } from "@strix/contracts"
import { Unexpected } from "@/api/errors.ts"

const FIELD_LABELS = new Map([
  ["name", "game name"],
  ["home.name", "home team"],
  ["home.jersey", "home jersey"],
  ["home.roster", "home roster"],
  ["away.name", "away team"],
  ["away.jersey", "away jersey"],
  ["away.roster", "away roster"],
  ["url", "video URL"],
])

const FIELD_DEPTH = 2

const labelOf = (path: string) => FIELD_LABELS.get(path.split(".").slice(0, FIELD_DEPTH).join(".")) ?? path

const fieldsOf = (error: InvalidInput) => [...new Set(error.fieldErrors.map(({ path }) => labelOf(path)))]

export const describeError = (error: Error): string => {
  if (error instanceof InvalidInput) return `Check the ${fieldsOf(error).join(", ")}.`
  if (error instanceof Unauthorized) return "Your sign-in has expired. Reload the page to sign in again."
  if (error instanceof ServiceUnavailable) return "Strix is unavailable right now. Try again in a moment."
  if (error instanceof NotFound) return "That game no longer exists."
  if (error instanceof Unexpected && error.status !== null) return `Something went wrong (HTTP ${error.status}).`
  return "Something went wrong. Try again."
}
