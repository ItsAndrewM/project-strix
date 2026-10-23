import {
  DEFAULT_THRESHOLDS,
  type Level,
  type Mode,
  type NewGame,
  type Side,
  type Team,
  TIMING_PRESETS,
} from "@strix/contracts"

export type FieldName = "name" | `${Side}Name` | `${Side}Jersey` | `${Side}Roster` | "url"

export type FieldErrors = Partial<Record<FieldName, string>>

export type Built = { readonly game: NewGame; readonly url: string } | { readonly errors: FieldErrors }

const MAX_JERSEY = 99
const REQUIRED = "Required"
const BAD_ROSTER = "Use jersey numbers 0–99, separated by commas"
const BAD_URL = "Enter an http or https URL"

const JERSEY = /^\d{1,2}$/u

const isJersey = (entry: string) => JERSEY.test(entry) && Number(entry) <= MAX_JERSEY

export const parseRoster = (text: string): number[] | null => {
  const entries = text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
  return entries.every(isJersey) ? entries.map(Number) : null
}

export const parseVideoUrl = (text: string): string | null => {
  const url = URL.parse(text.trim())
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null
}

const read = (form: FormData, field: FieldName) => String(form.get(field) ?? "").trim()

const team = (form: FormData, side: Side, errors: FieldErrors): Team => {
  const name = read(form, `${side}Name`)
  const jersey = read(form, `${side}Jersey`)
  const roster = parseRoster(read(form, `${side}Roster`))
  if (name === "") errors[`${side}Name`] = REQUIRED
  if (jersey === "") errors[`${side}Jersey`] = REQUIRED
  if (roster === null) errors[`${side}Roster`] = BAD_ROSTER
  return { name, jersey, roster: roster ?? [] }
}

export const buildNewGame = (form: FormData, mode: Mode, level: Level): Built => {
  const errors: FieldErrors = {}
  const name = read(form, "name")
  if (name === "") errors.name = REQUIRED
  const home = team(form, "home", errors)
  const away = team(form, "away", errors)
  const url = parseVideoUrl(read(form, "url"))
  if (url === null) errors.url = BAD_URL
  if (url === null || Object.keys(errors).length > 0) return { errors }
  return {
    game: { name, home, away, mode, level, thresholds: DEFAULT_THRESHOLDS, timing: TIMING_PRESETS[level] },
    url,
  }
}
