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
  readonly clipIndexes: ReadonlySet<number>
  readonly latestClipIndex: number
  readonly latestVideoMs: number
}

export const mergeAdjacent = <T extends Mergeable>(events: ReadonlyArray<T>): ReadonlyArray<T> => {
  const sorted = events.toSorted((a, b) => a.videoMs - b.videoMs || a.clipIndex - b.clipIndex)
  const groups: Array<Group<T>> = []
  for (const candidate of sorted) {
    const group = groups.findLast(
      (g) =>
        g.event.type === candidate.type &&
        g.event.team === candidate.team &&
        !g.clipIndexes.has(candidate.clipIndex) &&
        Math.abs(candidate.clipIndex - g.latestClipIndex) === 1 &&
        Math.abs(candidate.videoMs - g.latestVideoMs) <= MERGE_WITHIN_MS,
    )
    if (group === undefined) {
      groups.push({
        event: candidate,
        clipIndexes: new Set([candidate.clipIndex]),
        latestClipIndex: candidate.clipIndex,
        latestVideoMs: candidate.videoMs,
      })
      continue
    }
    const winner = candidate.confidence > group.event.confidence ? candidate : group.event
    groups[groups.indexOf(group)] = {
      event: {
        ...winner,
        videoMs: Math.min(group.event.videoMs, candidate.videoMs),
        clipIndex: Math.min(group.event.clipIndex, candidate.clipIndex),
      },
      clipIndexes: new Set([...group.clipIndexes, candidate.clipIndex]),
      latestClipIndex: candidate.clipIndex,
      latestVideoMs: candidate.videoMs,
    }
  }
  return groups.map((group) => group.event)
}
