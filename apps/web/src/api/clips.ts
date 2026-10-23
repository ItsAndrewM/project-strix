import { useQuery } from "@tanstack/react-query"
import { useApp } from "../app-context.ts"
import { gamesKeys } from "./games.ts"

export const useClips = (id: string) => {
  const { api } = useApp()
  return useQuery({
    queryKey: gamesKeys.clips(id),
    queryFn: () => api.request((client) => client.clips.listClips({ params: { id } })),
  })
}
