import type { EventStatus, EventType } from "@strix/contracts"
import type { CellState, Mark } from "./timeline-cells.ts"

export const TYPE_TONES = {
  goal: "bg-emerald-600 text-white",
  penalty: "bg-red-600 text-white",
  goalie_change: "bg-blue-600 text-white",
} satisfies Record<EventType, string>

export const EVENT_STATUS_TONES = {
  auto: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  draft: "bg-amber-400/25 text-amber-800 dark:text-amber-200",
  accepted: "bg-emerald-600 text-white",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  manual: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  discarded: "bg-muted text-muted-foreground line-through",
} satisfies Record<EventStatus, string>

export const CELL_TONES = {
  live: "bg-emerald-300 dark:bg-emerald-700/80",
  stoppage: "bg-amber-200 dark:bg-amber-700/60",
  intermission: "bg-stone-300 dark:bg-stone-600",
  warmup: "bg-sky-200 dark:bg-sky-800/70",
  empty: "bg-stone-100 dark:bg-stone-800",
  pending: "bg-muted bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--border)_4px_8px)]",
} satisfies Record<CellState, string>

export const CELL_LABELS = {
  live: "live play",
  stoppage: "stoppage",
  intermission: "intermission",
  warmup: "warmup",
  empty: "empty",
  pending: "not yet classified",
} satisfies Record<CellState, string>

export const MARK_TONES = {
  goal: "bg-emerald-600",
  penalty: "bg-red-600",
} satisfies Record<Mark, string>

export const CONFIDENT = 80
