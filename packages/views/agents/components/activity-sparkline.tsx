"use client";

interface BucketLike {
  total: number;
}

/**
 * 30-day activity as a line, drawn in the machine's hue (`var(--hue)`; the
 * draw-in is the `qw-spark` atom). Shared by the list card and the console's
 * machine seat so one agent's history looks the same in both places.
 */
export function ActivitySparkline({
  buckets,
  className = "h-5 w-[74px]",
}: {
  /** Oldest → newest; callers slice the window they want. */
  buckets: readonly BucketLike[];
  className?: string;
}) {
  if (buckets.length < 2) return null;
  const w = 74;
  const h = 20;
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const points = buckets
    .map((b, i) => {
      const x = (i / (buckets.length - 1)) * w;
      const y = h - (b.total / max) * (h - 3) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className={`qw-spark shrink-0 ${className}`}
      viewBox={`0 0 ${w} ${h}`}
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--hue)" }}
      />
    </svg>
  );
}
