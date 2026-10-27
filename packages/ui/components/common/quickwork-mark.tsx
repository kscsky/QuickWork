import { useId } from "react";
import { cn } from "../../lib/utils";

/**
 * The QuickWork mark: a machine seat with its status lamp on a navy tile.
 * The geometry and the palette are the launcher icon's — the source of truth
 * is `apps/desktop/scripts/generate-icons.mjs` (navy ink, brand blue band,
 * in-flight amber lamp); if the mark changes there, change it here in the
 * same pass.
 *
 * Inline SVG rather than the shipped bitmap so the tile stays crisp at
 * whatever size the surrounding type asks for. The gradient and clip ids are
 * per-instance (with `useId`'s colons stripped — `url(#…)` fragments want a
 * plain identifier): two marks on one page must not share one. The clip is
 * load-bearing: the band spans the full width, and its opaque end would
 * square off the tile's top-left corner without it.
 */
export function QuickWorkMark({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  const uid = useId().replace(/:/g, "");
  const band = `${uid}-band`;
  const tile = `${uid}-tile`;
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("block", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id={band} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1c63b0" />
          <stop offset="0.62" stopColor="#1c63b0" stopOpacity="0.25" />
          <stop offset="1" stopColor="#1c63b0" stopOpacity="0" />
        </linearGradient>
        <clipPath id={tile}>
          <rect width="100" height="100" rx="22" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${tile})`}>
        <rect width="100" height="100" fill="#1f344c" />
        <rect width="100" height="9" fill={`url(#${band})`} />
        <rect x="24" y="32" width="52" height="44" rx="7" fill="#ffffff" />
        <rect x="49" y="65" width="30" height="30" rx="10" fill="#1f344c" />
        <rect x="52" y="68" width="24" height="24" rx="6" fill="#c96a00" />
      </g>
    </svg>
  );
}
