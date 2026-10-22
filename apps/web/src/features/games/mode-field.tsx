import type { Mode } from "@strix/contracts"
import { useId } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MODE_OPTIONS } from "./constants.ts"

const modeIn = (values: ReadonlyArray<string>) => MODE_OPTIONS.find((option) => values.includes(option.value))?.value

export const ModeField = ({ mode, onChange }: { readonly mode: Mode; readonly onChange: (mode: Mode) => void }) => {
  const id = useId()
  return (
    <div className="grid content-start gap-1.5">
      <span id={id} className="text-sm leading-none font-medium">
        Mode
      </span>
      <ToggleGroup
        aria-labelledby={id}
        variant="outline"
        spacing={0}
        value={[mode]}
        onValueChange={(values: string[]) => {
          const next = modeIn(values)
          if (next !== undefined) onChange(next)
        }}
      >
        {MODE_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} className="px-4">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
