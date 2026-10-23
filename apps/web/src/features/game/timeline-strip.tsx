import { cn } from "cn"
import type { TimelineCell } from "./timeline-cells.ts"
import { TimelineLegend } from "./timeline-legend.tsx"
import { CELL_LABELS, CELL_TONES, MARK_TONES } from "./tones.ts"

interface TimelineStripProps {
  readonly cells: ReadonlyArray<TimelineCell>
  readonly onSelect: (index: number) => void
}

const describeCell = ({ index, state, marks }: TimelineCell) =>
  [`Clip ${index + 1}`, CELL_LABELS[state], ...marks].join(", ")

export const TimelineStrip = ({ cells, onSelect }: TimelineStripProps) => (
  <div className="grid gap-2">
    <ol aria-label="Clip timeline" className="flex h-6 gap-px">
      {cells.map((cell) => (
        <li key={cell.index} className="flex min-w-0.5 flex-1 first:*:rounded-l last:*:rounded-r">
          <button
            type="button"
            aria-label={describeCell(cell)}
            aria-current={cell.selected}
            title={describeCell(cell)}
            onClick={() => onSelect(cell.index)}
            className={cn(
              "flex flex-1 items-center justify-center gap-0.5 hover:brightness-95",
              CELL_TONES[cell.state],
              cell.selected && "z-10 outline-2 outline-offset-1 outline-foreground",
            )}
          >
            {cell.marks.map((mark) => (
              <span key={mark} aria-hidden className={cn("h-3.5 w-1 rounded-full", MARK_TONES[mark])} />
            ))}
          </button>
        </li>
      ))}
    </ol>
    <TimelineLegend />
  </div>
)
