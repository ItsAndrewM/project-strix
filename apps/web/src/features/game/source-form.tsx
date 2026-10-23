import { type FormEvent, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseVideoUrl } from "../games/new-game.ts"

interface SourceFormProps {
  readonly onSubmit: (url: string) => void
  readonly pending: boolean
  readonly error?: string | undefined
}

const BAD_URL = "Enter an http or https URL"

export const SourceForm = ({ onSubmit, pending, error }: SourceFormProps) => {
  const id = useId()
  const [invalid, setInvalid] = useState(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = parseVideoUrl(String(new FormData(event.currentTarget).get("url") ?? ""))
    setInvalid(url === null)
    if (url !== null) onSubmit(url)
  }
  const message = invalid ? BAD_URL : error
  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-1.5 pt-3">
      <Label htmlFor={id}>Video URL</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          name="url"
          type="url"
          placeholder="https://example.com/game.mp4"
          aria-invalid={message !== undefined}
          aria-describedby={message === undefined ? undefined : `${id}-error`}
          className="min-w-56 flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Reading…" : "Use this video"}
        </Button>
      </div>
      {message === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </form>
  )
}
