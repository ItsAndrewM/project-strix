import type { Clip, GameEvent, Mode, Thresholds } from "@strix/contracts"
import { decide, percentOf } from "@strix/domain"
import type { PassOneReading, TeamReading } from "./reading.ts"

const PRECISION_MS = 30_000

type Candidate = Pick<GameEvent, "type" | "needs" | "attrs"> & {
  readonly probability: number
  readonly team: TeamReading
}

const candidatesOf = (reading: PassOneReading): ReadonlyArray<Candidate> => [
  {
    type: "goal",
    probability: reading.goal,
    team: reading.goalTeam,
    needs: ["time", "scorer", "assists"],
    attrs: { scorer: null, scorerConfidence: null, assists: [] },
  },
  {
    type: "penalty",
    probability: reading.penalty,
    team: reading.penaltyTeam,
    needs: ["time", "player"],
    attrs: {
      infraction: reading.infraction.id,
      infractionConfidence: reading.infraction.confidence,
      class: reading.penaltyClass.id,
      classConfidence: reading.penaltyClass.confidence,
      player: null,
    },
  },
  {
    type: "goalie_change",
    probability: reading.goalieChange,
    team: reading.goalieChangeTeam,
    needs: ["time"],
    attrs: {},
  },
]

export const eventsFromPassOne = (
  clip: Pick<Clip, "index" | "startMs">,
  reading: PassOneReading,
  mode: Mode,
  thresholds: Thresholds,
  now: number,
  newId: () => string,
): ReadonlyArray<GameEvent> =>
  candidatesOf(reading).flatMap((candidate) => {
    const confidence = percentOf(candidate.probability)
    const status = decide(confidence, mode, thresholds)
    if (status === null) return []
    return [
      {
        id: newId(),
        type: candidate.type,
        team: candidate.team.team,
        teamConfidence: candidate.team.confidence,
        videoMs: clip.startMs,
        precisionMs: PRECISION_MS,
        clipIndex: clip.index,
        confidence,
        status,
        needs: candidate.needs,
        period: null,
        clock: null,
        attrs: candidate.attrs,
        createdAt: now,
      },
    ]
  })
