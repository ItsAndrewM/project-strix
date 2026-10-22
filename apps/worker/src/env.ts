import type { GameDO } from "./game/game-do.ts"
import type { SlicerContainer } from "./slicer/slicer-container.ts"

export interface ClassifyMessage {
  readonly gameId: string
  readonly clipIndex: number
  readonly pass: 1
}

export interface Env {
  readonly DB: D1Database
  readonly BUCKET: R2Bucket
  readonly AI: Ai
  readonly MEDIA: MediaBinding
  readonly GAME: DurableObjectNamespace<GameDO>
  readonly SLICER: DurableObjectNamespace<SlicerContainer>
  readonly CLASSIFY: Queue<ClassifyMessage>
  readonly ACCESS_TEAM_DOMAIN?: string
  readonly ACCESS_AUD?: string
  readonly R2_ACCESS_KEY_ID?: string
  readonly R2_SECRET_ACCESS_KEY?: string
  readonly R2_ENDPOINT?: string
  readonly FIXTURES?: "1"
  readonly FIXTURES_FAIL_PROBE?: "1"
  readonly FIXTURES_FAIL_SLICE_AFTER?: string
}
