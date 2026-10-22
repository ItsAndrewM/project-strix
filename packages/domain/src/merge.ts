export const MERGE_WITHIN_MS = 15_000

export interface Mergeable {
  readonly type: string
  readonly team: string
  readonly clipIndex: number
  readonly videoMs: number
  readonly confidence: number
}

interface Group<T extends Mergeable> {
  readonly event: T
  readonly latestClipIndex: number
  readonly latestVideoMs: number
}

export const mergeAdjacent = <T extends Mergeable>(events: ReadonlyArray<T>): ReadonlyArray<T> => {
  const sorted = events.toSorted((a, b) => a.videoMs - b.videoMs || a.clipIndex - b.clipIndex)
  const groups: Array<Group<T>> = []
  for (const candidate of sorted) {
    const at = groups.findLastIndex(
      (group) =>
        group.event.type === candidate.type &&
        group.event.team === candidate.team &&
        Math.abs(candidate.clipIndex - group.latestClipIndex) === 1 &&
        Math.abs(candidate.videoMs - group.latestVideoMs) <= MERGE_WITHIN_MS,
    )
    const group = groups[at]
    if (group === undefined) {
      groups.push({ event: candidate, latestClipIndex: candidate.clipIndex, latestVideoMs: candidate.videoMs })
      continue
    }
    const winner = candidate.confidence > group.event.confidence ? candidate : group.event
    groups[at] = {
      event: {
        ...winner,
        videoMs: Math.min(group.event.videoMs, candidate.videoMs),
        clipIndex: Math.min(group.event.clipIndex, candidate.clipIndex),
      },
      latestClipIndex: candidate.clipIndex,
      latestVideoMs: candidate.videoMs,
    }
  }
  return groups.map((group) => group.event)
}
