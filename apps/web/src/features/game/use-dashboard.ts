import { useRef, useState } from "react"
import { useClips } from "@/api/clips.ts"
import { useEvents } from "@/api/events.ts"
import { useKeyboard } from "./keyboard.ts"
import { listedEvents, seekMs, type Selection, selectedClipIndex, stepClip, stepEvent } from "./selection.ts"
import { cellsFor } from "./timeline-cells.ts"

const togglePlayback = (video: HTMLVideoElement | null) => {
  if (video === null) return
  if (video.paused) void video.play()
  else video.pause()
}

export const useDashboard = (gameId: string) => {
  const clips = useClips(gameId)
  const events = useEvents(gameId)
  const [selection, setSelection] = useState<Selection>(null)
  const [showDiscarded, setShowDiscarded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const allClips = clips.data ?? []
  const listed = listedEvents(events.data ?? [], showDiscarded)
  const selectedEvent = listed.find((event) => selection?.kind === "event" && event.id === selection.id) ?? null
  const clipIndex = selectedClipIndex(selection, selectedEvent, allClips)
  const clip = allClips.find((candidate) => candidate.index === clipIndex) ?? null

  const selectEvent = (id: string | null) => setSelection(id === null ? null : { kind: "event", id })
  const selectClip = (index: number | null) => setSelection(index === null ? null : { kind: "clip", index })
  const ids = listed.map(({ id }) => id)
  const indexes = allClips.map(({ index }) => index)

  useKeyboard({
    next: () => selectEvent(stepEvent(ids, selectedEvent?.id ?? null, 1)),
    prev: () => selectEvent(stepEvent(ids, selectedEvent?.id ?? null, -1)),
    clipNext: () => selectClip(stepClip(indexes, clipIndex, 1)),
    clipPrev: () => selectClip(stepClip(indexes, clipIndex, -1)),
    playPause: () => togglePlayback(videoRef.current),
  })

  return {
    events: { listed, isPending: events.isPending, error: events.error },
    showDiscarded,
    setShowDiscarded,
    selectedEvent,
    selectEvent,
    selectClip,
    videoRef,
    player: { clip, startAtMs: seekMs(selectedEvent, clip), autoPlay: selection !== null },
    cells: cellsFor(allClips, events.data ?? [], clipIndex),
  }
}
