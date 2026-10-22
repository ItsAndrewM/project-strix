import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { connectApi } from "./api/client.ts"
import { createQueryClient } from "./api/query-client.ts"
import { AppContext } from "./app-context.ts"
import { router } from "./shell/router.tsx"
import "./index.css"

const root = document.getElementById("root")
if (root === null) throw new Error("#root is missing from index.html")

const api = connectApi()
const queryClient = createQueryClient()

createRoot(root).render(
  <StrictMode>
    <AppContext value={{ api }}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppContext>
  </StrictMode>,
)
