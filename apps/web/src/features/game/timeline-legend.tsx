import { cn } from "cn"
import type { CellState, Mark } from "./timeline-cells.ts"
import { CELL_LABELS, CELL_TONES, MARK_TONES } from "./tones.ts"

const STATES: ReadonlyArray<CellState> = ["live", "stoppage", "intermission", "warmup", "empty", "pending"]
const MARKS: ReadonlyArray<Mark> = ["goal", "penalty"]

const Swatch = ({ tone, label }: { readonly tone: string; readonly label: string }) => (
  <li className="flex items-center gap-1.5">
    <span aria-hidden className={cn("size-2.5 rounded-sm", tone)} />
    {label}
  </li>
)

export const TimelineLegend = () => (
  <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
    {STATES.map((state) => (
      <Swatch key={state} tone={CELL_TONES[state]} label={CELL_LABELS[state]} />
    ))}
    {MARKS.map((mark) => (
      <Swatch key={mark} tone={MARK_TONES[mark]} label={mark} />
    ))}
    <li className="ml-auto">← → step clips · click to seek</li>
  </ul>
)
