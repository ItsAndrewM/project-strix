import { useQuery } from "@tanstack/react-query"
import { useApp } from "../app-context.ts"
import { gamesKeys } from "./games.ts"

export const useEvents = (id: string) => {
  const { api } = useApp()
  return useQuery({
    queryKey: gamesKeys.events(id),
    queryFn: () => api.request((client) => client.events.listEvents({ params: { id } })),
  })
}
