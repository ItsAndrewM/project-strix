import type { PointerEvent } from "react"
import type { Rect, Size } from "./crop-geometry.ts"
import type { DragMode } from "./use-crop-box.ts"

const HANDLE = 14

interface CropBoxProps {
  readonly rendered: Size
  readonly rect: Rect
  readonly begin: (mode: DragMode) => (event: PointerEvent<SVGRectElement>) => void
  readonly move: (event: PointerEvent<SVGSVGElement>) => void
  readonly end: () => void
}

const maskPath = ({ width, height }: Size, { x, y, width: w, height: h }: Rect) =>
  `M0 0H${width}V${height}H0Z M${x} ${y}h${w}v${h}h${-w}Z`

export const CropBox = ({ rendered, rect, begin, move, end }: CropBoxProps) => (
  <svg
    viewBox={`0 0 ${rendered.width} ${rendered.height}`}
    preserveAspectRatio="none"
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={end}
    className="absolute inset-0 size-full touch-none select-none"
  >
    <path d={maskPath(rendered, rect)} fillRule="evenodd" className="pointer-events-none fill-black/50" />
    <rect
      aria-label="Scoreboard area, drag to move"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
      onPointerDown={begin("move")}
      className="cursor-move fill-amber-300/10 stroke-amber-400"
    />
    <rect
      aria-label="Drag to resize"
      x={rect.x + rect.width - HANDLE / 2}
      y={rect.y + rect.height - HANDLE / 2}
      width={HANDLE}
      height={HANDLE}
      rx={3}
      onPointerDown={begin("resize")}
      className="cursor-nwse-resize fill-amber-400 stroke-black/40"
    />
  </svg>
)
