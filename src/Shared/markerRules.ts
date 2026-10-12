export type MarkerEdit = "place" | "drag";

/** Placement resets the opposite edge to the video boundary; dragging pushes it. */
export function editMarker(kind: "start" | "end", time: number, duration: number,
  start: number | null, end: number | null, intent: MarkerEdit) {
  const limit = Math.max(0, duration);
  const clamp = (value: number) => Math.max(0, Math.min(limit, Number.isFinite(value) ? value : 0));
  const next = clamp(time);
  let first = clamp(start ?? 0), last = clamp(end ?? limit);
  if (kind === "start") {
    first = next;
    if (first > last) last = intent === "place" ? limit : first;
  } else {
    last = next;
    if (last < first) first = intent === "place" ? 0 : last;
  }
  return { start: first, end: last };
}

/** Same displayed millisecond endpoints are duplicates; partial overlaps are allowed. */
export function sameSegment(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start.toFixed(3) === b.start.toFixed(3) && a.end.toFixed(3) === b.end.toFixed(3);
}
