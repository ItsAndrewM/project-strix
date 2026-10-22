import type { Clip, GameEvent } from "@strix/contracts"

export type Selection =
  | { readonly kind: "event"; readonly id: string }
  | { readonly kind: "clip"; readonly index: number }
  | null

const step = <T>(items: ReadonlyArray<T>, current: T | null, delta: 1 | -1): T | null => {
  const at = current === null ? -1 : items.indexOf(current)
  if (at === -1) return (delta === 1 ? items.at(0) : items.at(-1)) ?? null
  return items[Math.min(items.length - 1, Math.max(0, at + delta))] ?? null
}

export const stepEvent = (ids: ReadonlyArray<string>, current: string | null, delta: 1 | -1) =>
  step(ids, current, delta)

export const stepClip = (indexes: ReadonlyArray<number>, current: number | null, delta: 1 | -1) =>
  step(indexes, current, delta)

export const selectedClipIndex = (
  selection: Selection,
  event: GameEvent | null,
  clips: ReadonlyArray<Clip>,
): number | null => {
  if (event !== null) return event.clipIndex
  if (selection?.kind === "clip") return selection.index
  return clips.at(0)?.index ?? null
}

export const seekMs = (event: GameEvent | null, clip: Clip | null) =>
  event === null || clip === null ? 0 : Math.max(0, event.videoMs - clip.startMs)

export const listedEvents = (events: ReadonlyArray<GameEvent>, showDiscarded: boolean) =>
  events.filter((event) => showDiscarded || event.status !== "discarded")
