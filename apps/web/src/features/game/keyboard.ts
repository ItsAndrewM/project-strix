import { useEffect, useEffectEvent } from "react"

export type KeyAction = "next" | "prev" | "clipNext" | "clipPrev" | "playPause"

export type KeyHandlers = Readonly<Record<KeyAction, () => void>>

const ACTIONS = new Map<string, KeyAction>([
  ["j", "next"],
  ["k", "prev"],
  ["ArrowRight", "clipNext"],
  ["ArrowLeft", "clipPrev"],
  [" ", "playPause"],
])

export const keyFor = (key: string): KeyAction | null => ACTIONS.get(key) ?? null

const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"])

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (FORM_FIELDS.has(target.tagName) || target.isContentEditable)

const hasModifier = (event: KeyboardEvent) => event.altKey || event.ctrlKey || event.metaKey

export const useKeyboard = (handlers: KeyHandlers) => {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const action = keyFor(event.key)
    if (action === null || hasModifier(event) || isTyping(event.target)) return
    event.preventDefault()
    handlers[action]()
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])
}
