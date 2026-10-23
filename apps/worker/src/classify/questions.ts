import type { ClefQuestion, GameState, Infraction, PenaltyClass, Side, Team } from "@strix/contracts"

export const PASS_ONE_IDS = [
  "game_state",
  "goal",
  "goal_team",
  "penalty",
  "penalty_team",
  "infraction",
  "penalty_class",
  "shots_home",
  "shots_away",
  "goalie_change",
  "goalie_change_team",
] as const

export type PassOneId = (typeof PASS_ONE_IDS)[number]

const GAME_STATES = {
  live: "live play, puck in play",
  stoppage: "stoppage with players on the ice",
  intermission: "intermission or ice resurfacing",
  warmup: "pre-game warmup",
  empty: "empty ice or other",
} satisfies Record<GameState, string>

const INFRACTIONS = {
  holding: "holding: grabbing or hanging on to an opponent or their stick",
  slashing: "slashing: swinging the stick at an opponent",
  roughing: "roughing: punching or shoving an opponent, usually after the whistle",
  cross_checking: "cross-checking: hitting an opponent with the shaft of the stick held in both hands",
  checking_from_behind: "checking from behind: hitting an opponent who is facing away, often into the boards",
  tripping: "tripping: using the stick or body to make an opponent fall",
  hooking: "hooking: using the blade of the stick to pull or hold back an opponent",
  high_sticking: "high-sticking: hitting an opponent with the stick above the shoulders",
  interference: "interference: blocking or hitting an opponent who does not have the puck",
  delay_of_game: "delay of game: shooting the puck over the glass or holding up play",
  too_many_men: "too many men: a team has more players on the ice than allowed",
  boarding: "boarding: driving an opponent violently into the boards",
  elbowing: "elbowing: hitting an opponent with an elbow",
  unsportsmanlike: "unsportsmanlike conduct: arguing, taunting or other unsporting behaviour",
  other: "another infraction not listed here",
} satisfies Record<Infraction, string>

const PENALTY_CLASSES = {
  minor: "minor, 2 minutes",
  double_minor: "double minor, 4 minutes",
  major: "major, 5 minutes",
  misconduct: "misconduct, 10 minutes",
} satisfies Record<PenaltyClass, string>

const SHOT_LEVELS = ["0", "1", "2", "3", "4 or more"]

const labelOf = (team: Team): string => `${team.name}, wearing ${team.jersey}`

const teamChoice = (instructions: string, home: Team, away: Team): ClefQuestion => {
  const criteria = { home: labelOf(home), away: labelOf(away) } satisfies Record<Side, string>
  return { type: "choice", instructions, criteria }
}

const shotsBy = (team: Team): ClefQuestion => ({
  type: "score",
  instructions: `How many shots on goal did ${team.name} take in the first 25 seconds of this clip?`,
  criteria: SHOT_LEVELS,
})

export const passOneQuestions = (home: Team, away: Team) =>
  ({
    game_state: { type: "choice", instructions: "What is happening on the ice in this clip?", criteria: GAME_STATES },
    goal: {
      type: "noul",
      instructions:
        "A goal is scored in this clip: the puck crosses the goal line, players celebrate, the horn sounds, teams reset at centre ice",
    },
    goal_team: teamChoice("Which team scored the goal?", home, away),
    penalty: {
      type: "noul",
      instructions:
        "A penalty is called in this clip: the referee raises an arm or signals, a player goes to the box, play resumes short-handed",
    },
    penalty_team: teamChoice("Which team took the penalty?", home, away),
    infraction: { type: "choice", instructions: "What was the penalty called for?", criteria: INFRACTIONS },
    penalty_class: { type: "choice", instructions: "How long is the penalty?", criteria: PENALTY_CLASSES },
    shots_home: shotsBy(home),
    shots_away: shotsBy(away),
    goalie_change: {
      type: "noul",
      instructions: "A goalie leaves and another takes the net, or the net is left empty for an extra attacker",
    },
    goalie_change_team: teamChoice("Which team changed its goalie or emptied its net?", home, away),
  }) satisfies Record<PassOneId, ClefQuestion>
