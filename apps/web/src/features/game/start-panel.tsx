import type { Game } from "@strix/contracts"
import { useState } from "react"
import { useStartGame } from "@/api/games.ts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { describeError } from "@/lib/describe-error.ts"
import { ProbeFrame } from "./probe-frame.tsx"
import { useCropBox } from "./use-crop-box.ts"

export const StartPanel = ({ game }: { readonly game: Game }) => {
  const cropBox = useCropBox()
  const [noOverlay, setNoOverlay] = useState(false)
  const start = useStartGame(game.id)
  const canStart = !start.isPending && (noOverlay || cropBox.crop !== null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mark the scoreboard</CardTitle>
        <CardDescription>
          Drag the box over the score overlay so Strix can hide it from the model. Resize it from the corner.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProbeFrame gameId={game.id} cropBox={cropBox} showBox={!noOverlay} />
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch id="no-overlay" checked={noOverlay} onCheckedChange={setNoOverlay} />
          <Label htmlFor="no-overlay">No overlay</Label>
        </div>
        {start.error === null ? null : <p className="text-sm text-destructive">{describeError(start.error)}</p>}
        <Button className="ml-auto" disabled={!canStart} onClick={() => start.mutate(noOverlay ? null : cropBox.crop)}>
          {start.isPending ? "Starting…" : "Start"}
        </Button>
      </CardFooter>
    </Card>
  )
}
