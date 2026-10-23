import type { GameEvent, GoalAttrs, PenaltyAttrs } from "@strix/contracts"
import { classLabel, formatSeconds, formatVideoMs, infractionLabel, isGoal, isPenalty, TYPE_LABELS } from "./format.ts"
import type { Teams } from "./types.ts"

export interface DetailField {
  readonly label: string
  readonly value: string
}

const NONE = "—"

const jersey = (number: number, confidence: number | null) =>
  confidence === null ? `#${number}` : `#${number} (${confidence})`

const goalValue = ({ scorer, scorerConfidence, assists }: GoalAttrs) => {
  const scored = scorer === null ? NONE : jersey(scorer, scorerConfidence)
  const assisted = assists.map((assist) => jersey(assist.jersey, assist.confidence)).join(", ")
  return assisted === "" ? scored : `${scored} · A ${assisted}`
}

const penaltyValue = (attrs: PenaltyAttrs) =>
  [
    `${infractionLabel(attrs.infraction)} (${attrs.infractionConfidence})`,
    `${classLabel(attrs.class)} (${attrs.classConfidence})`,
    attrs.player === null ? NONE : `#${attrs.player}`,
  ].join(" · ")

const attrsField = ({ attrs }: GameEvent): DetailField => {
  if (isGoal(attrs)) return { label: "Scorer / assists", value: goalValue(attrs) }
  if (isPenalty(attrs)) return { label: "Infraction / player", value: penaltyValue(attrs) }
  return { label: "Details", value: NONE }
}

export const detailFields = (event: GameEvent, teams: Teams): ReadonlyArray<DetailField> => [
  { label: "Event", value: `${TYPE_LABELS[event.type]} · ${teams[event.team]}` },
  { label: "Confidence", value: `${event.confidence} / 100` },
  { label: "Placed", value: `${formatVideoMs(event.videoMs)} ± ${formatSeconds(event.precisionMs)}` },
  { label: "Period", value: event.period === null ? "unsure" : `P${event.period}` },
  { label: "Clock", value: event.clock ?? `${NONE} needs scorekeeper` },
  attrsField(event),
]
