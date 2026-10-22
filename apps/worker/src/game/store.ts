/**
 * The game DO's SQLite store. The machine's events (`auto`, `draft`, `discarded`) are stored exactly as each clip's
 * answer derived them; overlapping windows' sightings of one event are merged only when read (`mergedEventsOf`), so
 * the result never depends on the order answers arrive in and a redelivered answer cannot erase a neighbour's
 * sighting. Events a person decided (`accepted`, `rejected`, `manual`) are never merged. Event counts come from that
 * view, so a merged event counts once. A window the slicer could not cut is a clip with no renditions, classified
 * `failed`; if a late slice job does record it after all, it becomes a pending clip like any other.
 */
import {
  ClefResponse,
  Clip,
  Game,
  type GameCounts,
  type EventStatus,
  GameEvent,
  type GameState,
  type GameStatus,
  Rendition,
} from "@strix/contracts"
import { mergeAdjacent, type Window } from "@strix/domain"
import { Schema } from "effect"
import type { SliceCounts } from "./progress.ts"

const jsonOf = <S extends Schema.Top>(schema: S) => Schema.fromJsonString(Schema.toCodecJson(schema))

const GameJson = jsonOf(Game)
const encodeGame = Schema.encodeSync(GameJson)
const decodeGame = Schema.decodeUnknownSync(GameJson)

const RenditionsJson = jsonOf(Schema.Array(Rendition))
const encodeRenditions = Schema.encodeSync(RenditionsJson)
const decodeRenditions = Schema.decodeUnknownSync(RenditionsJson)
const decodeClip = Schema.decodeUnknownSync(Clip)

const ClefResponseJson = jsonOf(ClefResponse)
const encodeResponse = Schema.encodeSync(ClefResponseJson)
const decodeResponse = Schema.decodeUnknownSync(ClefResponseJson)

const GameEventJson = jsonOf(GameEvent)
const encodeEvent = Schema.encodeSync(GameEventJson)
const decodeEvent = Schema.decodeUnknownSync(GameEventJson)

type ClipRow = {
  idx: number
  start_ms: number
  duration_ms: number
  renditions: string
  state: string | null
  state_confidence: number | null
  classification: string
}

type JsonRow = { json: string }

type AnswerRow = { pass: number; window: number; json: string }

export interface Answer {
  readonly pass: number
  readonly window: number
  readonly response: ClefResponse
}

const CLIP_COLUMNS = "idx, start_ms, duration_ms, renditions, state, state_confidence, classification"

const clipOf = (row: ClipRow): Clip =>
  decodeClip({
    index: row.idx,
    startMs: row.start_ms,
    durationMs: row.duration_ms,
    renditions: decodeRenditions(row.renditions),
    state: row.state,
    stateConfidence: row.state_confidence,
    classification: row.classification,
  })

export const saveGame = (sql: SqlStorage, game: Game): void => {
  sql.exec(
    "INSERT INTO game (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
    encodeGame(game),
  )
}

export const readGame = (sql: SqlStorage): Game | undefined => {
  const [row] = sql.exec<JsonRow>("SELECT json FROM game WHERE id = 1").toArray()
  return row === undefined ? undefined : decodeGame(row.json)
}

export const changeGame = (sql: SqlStorage, change: (game: Game) => Game): Game => {
  const game = readGame(sql)
  if (game === undefined) throw new Error("the game changed before it was created")
  const changed = { ...change(game), counts: countsOf(sql) }
  saveGame(sql, changed)
  return changed
}

export const saveClip = (sql: SqlStorage, clip: Clip): void => {
  sql.exec(
    `INSERT INTO clips (${CLIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idx) DO UPDATE SET
       classification = CASE WHEN json_array_length(clips.renditions) = 0
         THEN excluded.classification ELSE clips.classification END,
       start_ms = excluded.start_ms,
       duration_ms = excluded.duration_ms,
       renditions = excluded.renditions`,
    clip.index,
    clip.startMs,
    clip.durationMs,
    encodeRenditions(clip.renditions),
    clip.state,
    clip.stateConfidence,
    clip.classification,
  )
}

export const saveUnslicedWindow = (sql: SqlStorage, window: Window): boolean =>
  sql.exec(
    `INSERT INTO clips (${CLIP_COLUMNS}) VALUES (?, ?, ?, ?, NULL, NULL, 'failed') ON CONFLICT(idx) DO NOTHING`,
    window.index,
    window.startMs,
    window.durationMs,
    encodeRenditions([]),
  ).rowsWritten > 0

export const sliceCountsOf = (sql: SqlStorage): SliceCounts =>
  sql
    .exec<{ sliced: number; unsliced: number }>(
      `SELECT COUNT(*) FILTER (WHERE json_array_length(renditions) > 0) AS sliced,
              COUNT(*) FILTER (WHERE json_array_length(renditions) = 0) AS unsliced
       FROM clips`,
    )
    .one()

export const readClips = (sql: SqlStorage): ReadonlyArray<Clip> =>
  sql.exec<ClipRow>(`SELECT ${CLIP_COLUMNS} FROM clips ORDER BY idx`).toArray().map(clipOf)

export const readClip = (sql: SqlStorage, index: number): Clip | undefined => {
  const [row] = sql.exec<ClipRow>(`SELECT ${CLIP_COLUMNS} FROM clips WHERE idx = ?`, index).toArray()
  return row === undefined ? undefined : clipOf(row)
}

export const markClassification = (
  sql: SqlStorage,
  index: number,
  classification: Clip["classification"],
  state: GameState | null,
  stateConfidence: number | null,
): void => {
  sql.exec(
    "UPDATE clips SET classification = ?, state = ?, state_confidence = ? WHERE idx = ?",
    classification,
    state,
    stateConfidence,
    index,
  )
}

export const saveAnswer = (
  sql: SqlStorage,
  clipIndex: number,
  pass: number,
  window: number,
  response: ClefResponse,
): void => {
  sql.exec(
    "INSERT INTO answers (clip_idx, pass, window, json, created_at) VALUES (?, ?, ?, ?, ?)",
    clipIndex,
    pass,
    window,
    encodeResponse(response),
    Date.now(),
  )
}

export const readAnswers = (sql: SqlStorage, clipIndex: number): ReadonlyArray<Answer> =>
  sql
    .exec<AnswerRow>("SELECT pass, window, json FROM answers WHERE clip_idx = ? ORDER BY id", clipIndex)
    .toArray()
    .map(({ pass, window, json }) => ({ pass, window, response: decodeResponse(json) }))

const INSERT_EVENT = "INSERT INTO events (id, clip_idx, video_ms, status, needs_count, json) VALUES (?, ?, ?, ?, ?, ?)"

const UPSERT_EVENT = `${INSERT_EVENT}
  ON CONFLICT(id) DO UPDATE SET
    clip_idx = excluded.clip_idx,
    video_ms = excluded.video_ms,
    status = excluded.status,
    needs_count = excluded.needs_count,
    json = excluded.json`

const INSERT_EVENT_UNLESS_PRESENT = `${INSERT_EVENT} ON CONFLICT(id) DO NOTHING`

const writeEvents = (sql: SqlStorage, statement: string, events: ReadonlyArray<GameEvent>): void => {
  for (const event of events) {
    sql.exec(statement, event.id, event.clipIndex, event.videoMs, event.status, event.needs.length, encodeEvent(event))
  }
}

export const saveEvents = (sql: SqlStorage, events: ReadonlyArray<GameEvent>): void => {
  writeEvents(sql, UPSERT_EVENT, events)
}

export const replaceEventsForClip = (
  storage: DurableObjectStorage,
  clipIndex: number,
  events: ReadonlyArray<GameEvent>,
): void => {
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM events WHERE clip_idx = ? AND status IN ('auto', 'draft', 'discarded')", clipIndex)
    writeEvents(storage.sql, INSERT_EVENT_UNLESS_PRESENT, events)
  })
}

export const readEvents = (sql: SqlStorage): ReadonlyArray<GameEvent> =>
  sql
    .exec<JsonRow>("SELECT json FROM events ORDER BY video_ms, id")
    .toArray()
    .map(({ json }) => decodeEvent(json))

const MACHINE: ReadonlySet<EventStatus> = new Set(["auto", "draft", "discarded"])

const UNCOUNTED: ReadonlySet<EventStatus> = new Set(["discarded", "rejected"])

const byTimeThenId = (a: GameEvent, b: GameEvent): number => a.videoMs - b.videoMs || (a.id < b.id ? -1 : 1)

export const mergedEventsOf = (sql: SqlStorage): ReadonlyArray<GameEvent> => {
  const events = readEvents(sql)
  const kept = events.filter((event) => !MACHINE.has(event.status))
  const machine = mergeAdjacent(events.filter((event) => MACHINE.has(event.status)))
  return [...kept, ...machine].toSorted(byTimeThenId)
}

export const countsOf = (sql: SqlStorage): GameCounts => {
  const clips = sql
    .exec<{ clips: number; classified: number }>(
      "SELECT COUNT(*) AS clips, COUNT(*) FILTER (WHERE classification = 'done') AS classified FROM clips",
    )
    .one()
  const counted = mergedEventsOf(sql).filter((event) => !UNCOUNTED.has(event.status))
  return {
    ...clips,
    events: counted.length,
    drafts: counted.filter((event) => event.status === "draft").length,
    needs: counted.filter((event) => event.needs.length > 0).length,
  }
}

const everyClipClassified = (sql: SqlStorage): boolean => {
  const { clips, pending } = sql
    .exec<{ clips: number; pending: number }>(
      "SELECT COUNT(*) AS clips, COUNT(*) FILTER (WHERE classification = 'pending') AS pending FROM clips",
    )
    .one()
  return clips > 0 && pending === 0
}

export const readiedIfClassified = (sql: SqlStorage, status: GameStatus): GameStatus =>
  status === "classifying" && everyClipClassified(sql) ? "ready" : status
