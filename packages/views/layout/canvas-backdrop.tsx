/**
 * The workspace canvas behind every page's content: the refresh world's
 * 26px dot paper, masked out toward the bottom so the ledger stays quiet.
 *
 * Render it as a child of a `relative overflow-hidden` shell box. It is
 * decoration only: the span is aria-hidden and pointer-transparent. Content
 * that must paint above it needs `relative z-[1]` on its own wrapper.
 */
export function CanvasBackdrop() {
  return <span aria-hidden="true" className="qw-canvas-dots" />;
}
