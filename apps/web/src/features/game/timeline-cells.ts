import type { Clip, GameEvent, GameState } from "@strix/contracts"

export type CellState = GameState | "pending"

export type Mark = "goal" | "penalty"

export interface TimelineCell {
  readonly index: number
  readonly state: CellState
  readonly marks: ReadonlyArray<Mark>
  readonly selected: boolean
}

const MARKS: ReadonlyArray<Mark> = ["goal", "penalty"]

const marksIn = (events: ReadonlyArray<GameEvent>, clipIndex: number): ReadonlyArray<Mark> =>
  MARKS.filter((mark) =>
    events.some((event) => event.clipIndex === clipIndex && event.type === mark && event.status !== "discarded"),
  )

export const cellsFor = (
  clips: ReadonlyArray<Clip>,
  events: ReadonlyArray<GameEvent>,
  selectedIndex: number | null,
): ReadonlyArray<TimelineCell> =>
  clips.map((clip) => ({
    index: clip.index,
    state: clip.state ?? "pending",
    marks: marksIn(events, clip.index),
    selected: clip.index === selectedIndex,
  }))
