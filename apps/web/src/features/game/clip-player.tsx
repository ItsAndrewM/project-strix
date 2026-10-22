import type { Clip } from "@strix/contracts"
import type { Ref, SyntheticEvent } from "react"
import { formatVideoMs } from "./format.ts"
import { viewUrl } from "./media.ts"

interface ClipPlayerProps {
  readonly gameId: string
  readonly clip: Clip | null
  readonly startAtMs: number
  readonly autoPlay: boolean
  readonly ref: Ref<HTMLVideoElement>
}

export const ClipPlayer = ({ gameId, clip, startAtMs, autoPlay, ref }: ClipPlayerProps) => {
  if (clip === null) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-neutral-900 text-sm text-neutral-400">
        No clips yet
      </div>
    )
  }
  const seek = ({ currentTarget }: SyntheticEvent<HTMLVideoElement>) => {
    currentTarget.currentTime = startAtMs / 1_000
  }
  return (
    <figure className="grid gap-1.5">
      <video
        ref={ref}
        src={viewUrl(gameId, clip.index)}
        controls
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        onLoadedMetadata={seek}
        className="aspect-video w-full rounded-lg bg-black"
      >
        <track kind="captions" />
      </video>
      <figcaption className="text-xs text-muted-foreground tabular-nums">
        Clip {clip.index + 1} · {formatVideoMs(clip.startMs)}–{formatVideoMs(clip.startMs + clip.durationMs)}
      </figcaption>
    </figure>
  )
}
