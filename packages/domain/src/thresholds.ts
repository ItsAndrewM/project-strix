export type Mode = "auto" | "review"

export interface Thresholds {
  autoSave: number
  draft: number
}

export type Decision = "auto" | "draft" | "discarded"

export const decide = (confidence: number, mode: Mode, thresholds: Thresholds): Decision | null => {
  if (confidence < thresholds.draft) {
    return null
  }
  if (mode === "review") {
    return "draft"
  }
  return confidence >= thresholds.autoSave ? "auto" : "discarded"
}
