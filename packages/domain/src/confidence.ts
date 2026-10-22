export const percentOf = (probability: number): number => Math.min(100, Math.max(1, Math.round(probability * 100)))

export const argmax = (probabilities: ReadonlyMap<string, number>): { key: string; probability: number } => {
  let best: { key: string; probability: number } | undefined
  for (const [key, probability] of probabilities) {
    if (best === undefined || probability > best.probability) {
      best = { key, probability }
    }
  }
  if (best === undefined) {
    throw new RangeError("argmax of an empty map")
  }
  return best
}
