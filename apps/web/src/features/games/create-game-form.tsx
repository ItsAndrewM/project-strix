import type { NewGame } from "@strix/contracts"
import { Button } from "@/components/ui/button"
import { LevelField } from "./level-field.tsx"
import { ModeField } from "./mode-field.tsx"
import { TeamFields } from "./team-fields.tsx"
import { TextField } from "./text-field.tsx"
import { useCreateGameForm } from "./use-create-game-form.ts"

interface CreateGameFormProps {
  readonly onSubmit: (game: NewGame, url: string) => void
  readonly pending: boolean
  readonly error?: string | undefined
}

export const CreateGameForm = ({ onSubmit, pending, error }: CreateGameFormProps) => {
  const { mode, setMode, level, setLevel, errors, handleSubmit } = useCreateGameForm(onSubmit)
  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-4">
      <TextField name="name" label="Game name" error={errors.name} placeholder="Hawks at Eagles" />
      <div className="grid gap-4">
        <TeamFields side="home" errors={errors} />
        <TeamFields side="away" errors={errors} />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-[auto_1fr]">
        <ModeField mode={mode} onChange={setMode} />
        <LevelField level={level} onChange={setLevel} />
      </div>
      <TextField
        name="url"
        type="url"
        label="Video URL"
        error={errors.url}
        placeholder="https://example.com/game.mp4"
      />
      {error === undefined ? null : (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="justify-self-start">
        {pending ? "Creating…" : "Create game"}
      </Button>
    </form>
  )
}
