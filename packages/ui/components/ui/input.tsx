import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@quickwork/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // `box-shadow` is in the transition list because the focus ring is
        // painted as one: a ring that appears in a single frame reads as a
        // flash rather than as the field lighting up.
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-title-sm transition-[color,background-color,border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-body dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
