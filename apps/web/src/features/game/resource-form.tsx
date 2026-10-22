import { useSetSource } from "@/api/games.ts"
import { describeError } from "@/lib/describe-error.ts"
import { SourceForm } from "./source-form.tsx"

export const ResourceForm = ({ gameId }: { readonly gameId: string }) => {
  const setSource = useSetSource(gameId)
  return (
    <SourceForm
      onSubmit={(url) => setSource.mutate(url)}
      pending={setSource.isPending}
      error={setSource.error === null ? undefined : describeError(setSource.error)}
    />
  )
}
