import { CropBox } from "./crop-box.tsx"
import { probeUrl } from "./media.ts"
import type { useCropBox } from "./use-crop-box.ts"

interface ProbeFrameProps {
  readonly gameId: string
  readonly cropBox: ReturnType<typeof useCropBox>
  readonly showBox: boolean
}

export const ProbeFrame = ({ gameId, cropBox, showBox }: ProbeFrameProps) => {
  const { probe, onLoad, onError, begin, move, end } = cropBox
  if (probe.kind === "failed") {
    return (
      <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        The probe frame could not be loaded. You can still start with no overlay.
      </p>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-lg bg-neutral-900">
      <img
        src={probeUrl(gameId)}
        alt="A frame from the game video"
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className="block h-auto w-full"
      />
      {showBox && probe.kind === "ready" ? (
        <CropBox rendered={probe.frame.rendered} rect={probe.rect} begin={begin} move={move} end={end} />
      ) : null}
    </div>
  )
}
