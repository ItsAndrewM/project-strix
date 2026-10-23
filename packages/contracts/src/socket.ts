import { Schema } from "effect"

export const socketPath = (gameId: string): string => `/api/games/${gameId}/ws`

export const HEARTBEAT = { ping: "ping", pong: "pong" } as const

export const Changed = Schema.Literals(["game", "clips", "events"])
export type Changed = typeof Changed.Type

export const ChangedMessage = Schema.Struct({ changed: Schema.Array(Changed) })
export type ChangedMessage = typeof ChangedMessage.Type
