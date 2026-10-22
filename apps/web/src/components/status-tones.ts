import type { GameStatus } from "@strix/contracts"

export const STATUS_TONES = {
  created: "bg-secondary text-secondary-foreground",
  probing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  slicing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  classifying: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
} satisfies Record<GameStatus, string>
