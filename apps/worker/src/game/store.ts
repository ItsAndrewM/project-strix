import { ClefResponse, Clip, Game, type GameCounts, GameEvent, type GameState, Rendition } from "@strix/contracts"
import { Schema } from "effect"

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

export const saveClip = (sql: SqlStorage, clip: Clip): void => {
  sql.exec(
    `INSERT INTO clips (${CLIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idx) DO UPDATE SET
       start_ms = excluded.start_ms,
       duration_ms = excluded.duration_ms,
       renditions = excluded.renditions,
       state = excluded.state,
       state_confidence = excluded.state_confidence,
       classification = excluded.classification`,
    clip.index,
    clip.startMs,
    clip.durationMs,
    encodeRenditions(clip.renditions),
    clip.state,
    clip.stateConfidence,
    clip.classification,
  )
}

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

export const saveEvents = (sql: SqlStorage, events: ReadonlyArray<GameEvent>): void => {
  for (const event of events) {
    sql.exec(
      `INSERT INTO events (id, clip_idx, video_ms, status, needs_count, json) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         clip_idx = excluded.clip_idx,
         video_ms = excluded.video_ms,
         status = excluded.status,
         needs_count = excluded.needs_count,
         json = excluded.json`,
      event.id,
      event.clipIndex,
      event.videoMs,
      event.status,
      event.needs.length,
      encodeEvent(event),
    )
  }
}

export const replaceEventsForClip = (
  storage: DurableObjectStorage,
  clipIndex: number,
  events: ReadonlyArray<GameEvent>,
): void => {
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM events WHERE clip_idx = ? AND status IN ('auto', 'draft', 'discarded')", clipIndex)
    saveEvents(storage.sql, events)
  })
}

export const readEvents = (sql: SqlStorage): ReadonlyArray<GameEvent> =>
  sql
    .exec<JsonRow>("SELECT json FROM events ORDER BY video_ms, id")
    .toArray()
    .map(({ json }) => decodeEvent(json))

export const countsOf = (sql: SqlStorage): GameCounts => {
  const clips = sql
    .exec<{ clips: number; classified: number }>(
      "SELECT COUNT(*) AS clips, COUNT(*) FILTER (WHERE classification = 'done') AS classified FROM clips",
    )
    .one()
  const events = sql
    .exec<{ events: number; drafts: number; needs: number }>(
      `SELECT COUNT(*) AS events,
         COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
         COUNT(*) FILTER (WHERE needs_count > 0) AS needs
       FROM events WHERE status NOT IN ('discarded', 'rejected')`,
    )
    .one()
  return { ...clips, ...events }
}
