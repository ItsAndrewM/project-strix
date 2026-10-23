import type { Need } from "@strix/contracts"

export const NeedTags = ({ needs }: { readonly needs: ReadonlyArray<Need> }) =>
  needs.map((need) => (
    <span
      key={need}
      className="rounded border border-red-600/60 px-1.5 text-[0.7rem] font-medium text-red-700 dark:text-red-300"
    >
      needs {need}
    </span>
  ))
