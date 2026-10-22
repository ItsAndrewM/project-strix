import { CONFIDENT } from "./tones.ts"

const MAX = 100

export const ConfidenceBar = ({ value }: { readonly value: number }) => (
  <span className="block" title={`Confidence ${value} / ${MAX}`}>
    <svg
      aria-hidden
      viewBox={`0 0 ${MAX} 1`}
      preserveAspectRatio="none"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <rect
        width={Math.min(MAX, Math.max(0, value))}
        height={1}
        className={value >= CONFIDENT ? "fill-emerald-600" : "fill-amber-500"}
      />
    </svg>
    <span className="sr-only">
      Confidence {value} of {MAX}
    </span>
  </span>
)
