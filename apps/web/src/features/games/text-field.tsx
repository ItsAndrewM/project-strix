import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { FieldName } from "./new-game.ts"

interface TextFieldProps {
  readonly name: FieldName
  readonly label: string
  readonly error: string | undefined
  readonly placeholder?: string
  readonly type?: "text" | "url"
}

export const TextField = ({ name, label, error, placeholder, type = "text" }: TextFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
