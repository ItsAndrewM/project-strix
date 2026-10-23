import { cn } from "cn"
import type { ReactNode } from "react"

interface GameNoticeProps {
  readonly title: string
  readonly children: string
  readonly failed?: boolean
  readonly action?: ReactNode
}

export const GameNotice = ({ title, children, failed = false, action }: GameNoticeProps) => (
  <div
    className={cn(
      "grid gap-1 rounded-xl border px-5 py-6",
      failed ? "border-destructive/40 bg-destructive/5" : "bg-card",
    )}
  >
    <div role={failed ? "alert" : "status"} className="grid gap-1">
      <p className={cn("font-medium", failed && "text-destructive")}>{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
    {action}
  </div>
)
