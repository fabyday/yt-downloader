export type ZoomPivot = "playhead" | "start" | "end";
export type TimelineHandle = ZoomPivot;
export const TIMELINE_HANDLE_THRESHOLD = 12;

/** Pick by horizontal distance, independent of the pointer's vertical row. */
export function nearestTimelineHandle(
  x: number, handles: { kind: TimelineHandle; x: number }[], preferred: TimelineHandle | null,
  threshold = TIMELINE_HANDLE_THRESHOLD,
): TimelineHandle | null {
  return handles.filter(handle => Math.abs(handle.x - x) <= threshold)
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) ||
      Number(b.kind === preferred) - Number(a.kind === preferred) ||
      ["start", "end", "playhead"].indexOf(a.kind) - ["start", "end", "playhead"].indexOf(b.kind))[0]?.kind ?? null;
}

/** Keep the chosen time at the same screen position; reveal an off-screen pivot at center. */
export function zoomViewportStart(start: number, span: number, nextSpan: number, pivot: number, duration: number): number {
  const ratio = pivot >= start && pivot <= start + span && span > 0 ? (pivot - start) / span : 0.5;
  return Math.max(0, Math.min(duration - nextSpan, pivot - nextSpan * ratio));
}
