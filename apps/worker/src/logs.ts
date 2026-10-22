import type { Refusal } from "./access.ts"

export type Refused = Refusal | "service-token" | "not-json" | "no-forwarded-email" | "foreign-origin"

export type Outage = "keys-unavailable" | "index-unavailable" | "game-unavailable"

export interface DefectContext {
  readonly route: string
  readonly gameId: string | null
}

export const routeOf = (method: string, url: string): string => `${method} ${new URL(url).pathname}`

export const logRefusal = (route: string, reason: Refused): void => {
  console.warn({ event: "refused", reason, route })
}

export const logOutage = (event: Outage, route: string, cause: string): void => {
  console.error({ event, route, cause })
}

export const logDefect = (context: DefectContext): void => {
  console.error({ event: "defect", ...context })
}
