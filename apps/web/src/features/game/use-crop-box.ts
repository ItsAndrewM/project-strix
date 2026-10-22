import type { PointerEvent, SyntheticEvent } from "react"
import { useRef, useState } from "react"
import { initialRect, moveRect, type Rect, resizeRect, type Size, toSource } from "./crop-geometry.ts"

export type DragMode = "move" | "resize"

export interface Frame {
  readonly rendered: Size
  readonly natural: Size
}

export type Probe =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly frame: Frame; readonly rect: Rect }

interface Drag {
  readonly mode: DragMode
  readonly startX: number
  readonly startY: number
  readonly scale: number
  readonly from: Rect
}

const frameOf = (image: HTMLImageElement): Frame => ({
  rendered: { width: image.clientWidth, height: image.clientHeight },
  natural: { width: image.naturalWidth, height: image.naturalHeight },
})

const dragged = (drag: Drag, event: PointerEvent<SVGSVGElement>, bounds: Size) => {
  const delta = { dx: (event.clientX - drag.startX) * drag.scale, dy: (event.clientY - drag.startY) * drag.scale }
  return drag.mode === "move" ? moveRect(drag.from, delta, bounds) : resizeRect(drag.from, delta, bounds)
}

export const useCropBox = () => {
  const [probe, setProbe] = useState<Probe>({ kind: "loading" })
  const drag = useRef<Drag | null>(null)

  const onLoad = ({ currentTarget }: SyntheticEvent<HTMLImageElement>) => {
    const frame = frameOf(currentTarget)
    if (frame.rendered.width === 0 || frame.rendered.height === 0) return setProbe({ kind: "failed" })
    setProbe({ kind: "ready", frame, rect: initialRect(frame.rendered) })
  }

  const begin = (mode: DragMode) => (event: PointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (probe.kind !== "ready" || svg === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const scale = probe.frame.rendered.width / svg.getBoundingClientRect().width
    drag.current = { mode, startX: event.clientX, startY: event.clientY, scale, from: probe.rect }
  }

  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current === null || probe.kind !== "ready") return
    setProbe({ ...probe, rect: dragged(drag.current, event, probe.frame.rendered) })
  }

  const end = () => {
    drag.current = null
  }

  const crop = probe.kind === "ready" ? toSource(probe.rect, probe.frame.rendered, probe.frame.natural) : null
  return { probe, crop, onLoad, onError: () => setProbe({ kind: "failed" }), begin, move, end }
}
