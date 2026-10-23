import type { Crop, Game, NewGame } from "@strix/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApp } from "../app-context.ts"

const LIST_STALE_MS = 5_000

export const gamesKeys = {
  all: () => ["games"] as const,
  list: () => ["games", "list"] as const,
  one: (id: string) => ["games", "one", id] as const,
  clips: (id: string) => ["games", "one", id, "clips"] as const,
  events: (id: string) => ["games", "one", id, "events"] as const,
}

export const useGames = () => {
  const { api } = useApp()
  return useQuery({
    queryKey: gamesKeys.list(),
    queryFn: () => api.request((client) => client.games.listGames()),
    staleTime: LIST_STALE_MS,
  })
}

export const useGame = (id: string) => {
  const { api } = useApp()
  return useQuery({
    queryKey: gamesKeys.one(id),
    queryFn: () => api.request((client) => client.games.getGame({ params: { id } })),
  })
}

export const useCacheGame = () => {
  const queryClient = useQueryClient()
  return (game: Game) => {
    queryClient.setQueryData(gamesKeys.one(game.id), game)
    return queryClient.invalidateQueries({ queryKey: gamesKeys.list() })
  }
}

export const useCreateGame = () => {
  const { api } = useApp()
  const cacheGame = useCacheGame()
  return useMutation({
    mutationFn: (game: NewGame) => api.request((client) => client.games.createGame({ payload: game })),
    onSuccess: cacheGame,
  })
}

export const useSetSource = (id: string) => {
  const { api } = useApp()
  const cacheGame = useCacheGame()
  return useMutation({
    mutationFn: (url: string) => api.request((client) => client.games.setSource({ params: { id }, payload: { url } })),
    onSuccess: cacheGame,
  })
}

export const useStartGame = (id: string) => {
  const { api } = useApp()
  const cacheGame = useCacheGame()
  return useMutation({
    mutationFn: (crop: Crop | null) =>
      api.request((client) => client.games.startGame({ params: { id }, payload: { crop } })),
    onSuccess: cacheGame,
  })
}
