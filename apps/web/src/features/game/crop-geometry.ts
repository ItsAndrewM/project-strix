import type { Crop } from "@strix/contracts"

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect extends Size {
  readonly x: number
  readonly y: number
}

export interface Delta {
  readonly dx: number
  readonly dy: number
}

const INSET_PERCENT = 5
const WIDTH_PERCENT = 40
const HEIGHT_PERCENT = 12
const MIN_SIDE = 16

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const percentOf = (size: number, percent: number) => (size * percent) / 100

export const initialRect = (rendered: Size): Rect => ({
  x: percentOf(rendered.width, INSET_PERCENT),
  y: percentOf(rendered.height, INSET_PERCENT),
  width: percentOf(rendered.width, WIDTH_PERCENT),
  height: percentOf(rendered.height, HEIGHT_PERCENT),
})

export const moveRect = (rect: Rect, { dx, dy }: Delta, bounds: Size): Rect => ({
  ...rect,
  x: clamp(rect.x + dx, 0, bounds.width - rect.width),
  y: clamp(rect.y + dy, 0, bounds.height - rect.height),
})

export const resizeRect = (rect: Rect, { dx, dy }: Delta, bounds: Size): Rect => ({
  ...rect,
  width: clamp(rect.width + dx, MIN_SIDE, bounds.width - rect.x),
  height: clamp(rect.height + dy, MIN_SIDE, bounds.height - rect.y),
})

const span = (start: number, length: number, scale: number, limit: number) => {
  const from = clamp(Math.round(start * scale), 0, limit)
  const to = clamp(Math.round((start + length) * scale), 0, limit)
  return { from, length: to - from }
}

export const toSource = (rect: Rect, rendered: Size, natural: Size): Crop => {
  const across = span(rect.x, rect.width, natural.width / rendered.width, natural.width)
  const down = span(rect.y, rect.height, natural.height / rendered.height, natural.height)
  return { x: across.from, y: down.from, width: across.length, height: down.length }
}
