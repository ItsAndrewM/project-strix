import type { Level, Mode } from "@strix/contracts"

export const LEVEL_OPTIONS: ReadonlyArray<{ readonly value: Level; readonly label: string }> = [
  { value: "youth-running", label: "Youth, running time" },
  { value: "youth-stop", label: "Youth, stop time" },
  { value: "junior-pro", label: "Junior / pro" },
]

export const MODE_OPTIONS: ReadonlyArray<{ readonly value: Mode; readonly label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "review", label: "Review" },
]
