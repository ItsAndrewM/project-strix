import type { GameStatus } from "@strix/contracts"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { STATUS_TONES } from "./status-tones.ts"

export const StatusBadge = ({ status }: { readonly status: GameStatus }) => (
  <Badge className={cn("gap-1.5 capitalize", STATUS_TONES[status])}>
    <span aria-hidden className="size-1.5 rounded-full bg-current" />
    {status}
  </Badge>
)
