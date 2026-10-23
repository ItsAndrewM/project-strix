import type { NewGame } from "@strix/contracts"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCacheGame, useCreateGame } from "@/api/games.ts"
import { useApp } from "@/app-context.ts"
import { describeError } from "@/lib/describe-error.ts"

export const useAddGame = () => {
  const { api } = useApp()
  const navigate = useNavigate()
  const create = useCreateGame()
  const cacheGame = useCacheGame()
  const add = useMutation({
    mutationFn: async ({ game, url }: { readonly game: NewGame; readonly url: string }) => {
      const created = await create.mutateAsync(game)
      return api.request((client) => client.games.setSource({ params: { id: created.id }, payload: { url } }))
    },
    onSuccess: cacheGame,
  })

  const submit = (game: NewGame, url: string) =>
    add.mutate(
      { game, url },
      {
        onSuccess: (probed) => {
          if (probed.status !== "failed") void navigate({ to: "/games/$gameId", params: { gameId: probed.id } })
        },
      },
    )

  const failure = add.data?.status === "failed" ? (add.data.failure ?? "The video could not be read.") : undefined
  const error = add.error === null ? failure : describeError(add.error)
  return { submit, pending: add.isPending, error }
}
