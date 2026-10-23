import { Button } from "@/components/ui/button"

const LATER = "Arrives with review"

export const EventActions = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" disabled title={LATER}>
      Accept (a)
    </Button>
    <Button size="sm" variant="outline" disabled title={LATER} className="text-destructive">
      Reject (r)
    </Button>
    <Button size="sm" variant="outline" disabled title={LATER}>
      Set period + clock (t)
    </Button>
    <span className="text-xs text-muted-foreground">Review actions arrive with the review plan.</span>
    <kbd className="ml-auto font-sans text-xs text-muted-foreground">j / k next / prev · space play / pause</kbd>
  </div>
)
