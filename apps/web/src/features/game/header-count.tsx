import { cn } from "cn"

interface HeaderCountProps {
  readonly label: string
  readonly value: string
  readonly alert: boolean
}

export const HeaderCount = ({ label, value, alert }: HeaderCountProps) => (
  <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
    <dt className="text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "rounded-full px-1.5 font-semibold tabular-nums",
        alert ? "bg-red-600 text-white" : "bg-muted text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
)
