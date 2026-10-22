import type { Side } from "@strix/contracts"
import type { FieldErrors } from "./new-game.ts"
import { TextField } from "./text-field.tsx"

const TITLES = { home: "Home", away: "Away" } satisfies Record<Side, string>

export const TeamFields = ({ side, errors }: { readonly side: Side; readonly errors: FieldErrors }) => {
  const title = TITLES[side]
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <TextField name={`${side}Name`} label={`${title} team`} error={errors[`${side}Name`]} />
        <TextField
          name={`${side}Jersey`}
          label={`${title} jersey`}
          error={errors[`${side}Jersey`]}
          placeholder="white"
        />
      </div>
      <TextField
        name={`${side}Roster`}
        label={`${title} roster`}
        error={errors[`${side}Roster`]}
        placeholder="2, 7, 19, 30"
      />
    </fieldset>
  )
}
