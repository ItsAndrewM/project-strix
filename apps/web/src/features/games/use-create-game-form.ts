import type { Level, Mode, NewGame } from "@strix/contracts"
import { type FormEvent, useState } from "react"
import { buildNewGame, type FieldErrors } from "./new-game.ts"

export const useCreateGameForm = (onSubmit: (game: NewGame, url: string) => void) => {
  const [mode, setMode] = useState<Mode>("review")
  const [level, setLevel] = useState<Level>("junior-pro")
  const [errors, setErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const built = buildNewGame(new FormData(event.currentTarget), mode, level)
    if ("errors" in built) {
      setErrors(built.errors)
      return
    }
    setErrors({})
    onSubmit(built.game, built.url)
  }

  return { mode, setMode, level, setLevel, errors, handleSubmit }
}
