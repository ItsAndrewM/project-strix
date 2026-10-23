import { type Level, TIMING_PRESETS } from "@strix/contracts"
import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LEVEL_OPTIONS } from "./constants.ts"

const levelIn = (value: string | null) => LEVEL_OPTIONS.find((option) => option.value === value)?.value

const TimingReadout = ({ level }: { readonly level: Level }) => {
  const timing = TIMING_PRESETS[level]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
      <li>{timing.periodMinutes} min periods</li>
      <li>{timing.intermissionMin} min intermissions</li>
      <li>{timing.ambiguousMin} min ambiguous</li>
    </ul>
  )
}

export const LevelField = ({
  level,
  onChange,
}: {
  readonly level: Level
  readonly onChange: (level: Level) => void
}) => {
  const id = useId()
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>Level</Label>
      <Select
        items={LEVEL_OPTIONS}
        value={level}
        onValueChange={(value: string | null) => {
          const next = levelIn(value)
          if (next !== undefined) onChange(next)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEVEL_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TimingReadout level={level} />
    </div>
  )
}
