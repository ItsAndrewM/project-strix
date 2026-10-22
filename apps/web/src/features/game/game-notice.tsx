import { cn } from "cn"

interface GameNoticeProps {
  readonly title: string
  readonly children: string
  readonly failed?: boolean
}

export const GameNotice = ({ title, children, failed = false }: GameNoticeProps) => (
  <div
    role={failed ? "alert" : "status"}
    className={cn(
      "grid gap-1 rounded-xl border px-5 py-6",
      failed ? "border-destructive/40 bg-destructive/5" : "bg-card",
    )}
  >
    <p className={cn("font-medium", failed && "text-destructive")}>{title}</p>
    <p className="text-sm text-muted-foreground">{children}</p>
  </div>
)
