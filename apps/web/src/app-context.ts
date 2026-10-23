import { createContext, use } from "react"
import type { StrixApi } from "./api/client.ts"

export interface App {
  readonly api: StrixApi
}

export const AppContext = createContext<App | null>(null)

export const useApp = () => {
  const app = use(AppContext)
  if (app === null) throw new Error("useApp runs inside <AppContext>")
  return app
}
