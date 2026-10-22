import { Link } from "@tanstack/react-router"

export const NotFoundPage = () => (
  <div className="grid gap-2">
    <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
    <p className="text-muted-foreground">
      There's nothing here.{" "}
      <Link to="/" className="font-medium text-foreground underline underline-offset-4">
        Go to games
      </Link>
    </p>
  </div>
)
