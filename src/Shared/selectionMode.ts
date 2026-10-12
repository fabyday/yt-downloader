export type SelectionMode = "clamp" | "follow" | "free";

export function movePlayhead(mode: SelectionMode, time: number, duration: number, start: number | null, end: number | null) {
  const next = Math.max(0, Math.min(duration, Number.isFinite(time) ? time : 0));
  if (start === null || end === null || end < start) return { time: next, start, end };
  if (mode === "clamp") return { time: Math.max(start, Math.min(end, next)), start, end };
  if (mode === "follow") return { time: next, start: Math.min(start, next), end: Math.max(end, next) };
  return { time: next, start, end };
}
