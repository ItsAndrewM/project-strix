import type { EventType } from "@strix/contracts"
import { cn } from "cn"
import { TYPE_LABELS } from "./format.ts"
import { TYPE_TONES } from "./tones.ts"

export const TypeBadge = ({ type }: { readonly type: EventType }) => (
  <span className={cn("rounded px-1.5 text-[0.7rem] font-semibold", TYPE_TONES[type])}>{TYPE_LABELS[type]}</span>
)
