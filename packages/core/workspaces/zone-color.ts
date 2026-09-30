/**
 * Deterministic workspace → zone hue index.
 *
 * The unit of work in this product is the zone (a workspace), and the console
 * shows work from several at once. Colour is the cheapest way to make origin
 * readable without reading it, so each zone gets one of {@link ZONE_COUNT}
 * hues from the `--zone-*` token family.
 *
 * FNV-1a over the slug rather than a stored assignment: it needs no column, no
 * round-trip, and two clients rendering the same workspace agree without
 * coordinating. The tradeoff is that similar slugs can collide — acceptable,
 * because the colour is a scanning aid and the slug itself is always on screen
 * next to it.
 *
 * Returns an INDEX, not a class name. A hex or Tailwind class returned from
 * here would either bypass the token layer or be invisible to Tailwind's
 * source scan (which only sees literal `bg-zone-N` strings in the view).
 */
export const ZONE_COUNT = 8;

export function zoneIndex(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % ZONE_COUNT;
}

/** 1-based token suffix, e.g. `zoneIndexSlot("alpha") === 3` → `--zone-3`. */
export function zoneIndexSlot(slug: string): number {
  return zoneIndex(slug) + 1;
}
