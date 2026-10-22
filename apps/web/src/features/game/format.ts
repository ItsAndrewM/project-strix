import {
  type EventType,
  GoalAttrs,
  type Infraction,
  PENALTY_MINUTES,
  PenaltyAttrs,
  type PenaltyClass,
} from "@strix/contracts"
import { Schema } from "effect"

const pad = (value: number) => String(value).padStart(2, "0")

export const formatVideoMs = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1_000)
  return `${Math.floor(seconds / 3_600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

const precision = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

export const formatSeconds = (ms: number) => `${precision.format(ms / 1_000)} s`

export const TYPE_LABELS = {
  goal: "Goal",
  penalty: "Penalty",
  goalie_change: "Goalie change",
} satisfies Record<EventType, string>

export const infractionLabel = (infraction: Infraction) => infraction.replaceAll("_", " ")

export const classLabel = (penaltyClass: PenaltyClass) =>
  `${penaltyClass.replaceAll("_", " ")} ${PENALTY_MINUTES[penaltyClass]}`

export const isGoal = Schema.is(GoalAttrs)

export const isPenalty = Schema.is(PenaltyAttrs)
