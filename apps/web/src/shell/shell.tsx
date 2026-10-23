import { Link, Outlet } from "@tanstack/react-router"

export const Shell = () => (
  <div className="flex min-h-dvh flex-col">
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Strix
        </Link>
      </div>
    </header>
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <Outlet />
    </main>
  </div>
)
