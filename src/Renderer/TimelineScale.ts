import type { TimelineRulerViewItem } from "./viewStore";

/** Choose readable intervals without a maximum video length. */
export function timelineMajorInterval(span: number, width: number, labelWidth: number): number {
  const target = span / Math.max(1, width / Math.max(90, labelWidth + 20));
  const intervals = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];
  return intervals.find(value => value >= target) ?? Math.ceil(target / 86400) * 86400;
}

/** Keep both viewport endpoints visible and reserve space around their labels. */
export function buildTimelineTicks(
  viewport: { start: number; end: number; span: number },
  width: number,
  format: (time: number, interval: number) => string,
): TimelineRulerViewItem[] {
  if (viewport.span <= 0 || width <= 0) return [];
  const labelWidth = Math.max(format(viewport.end, 0.1).length, format(viewport.start, 0.1).length) * 7;
  const major = timelineMajorInterval(viewport.span, width, labelWidth);
  const minor = major / 5;
  const items: TimelineRulerViewItem[] = [];
  const first = Math.ceil(viewport.start / minor);
  const last = Math.floor(viewport.end / minor);
  for (let index = first; index <= last; index++) {
    const time = index * minor;
    const ratio = (time - viewport.start) / viewport.span;
    if (ratio < 0.000001 || ratio > 0.999999) continue;
    const isMajor = index % 5 === 0;
    const hasRoom = ratio * width > labelWidth * 1.5 + 8 && (1 - ratio) * width > labelWidth * 1.5 + 8;
    items.push({ id: `tick-${index}`, left: `${ratio * 100}%`, major: isMajor,
      label: isMajor && hasRoom ? format(time, major) : null, align: "center" });
  }
  items.push({ id: "start", left: "0%", major: true,
    label: width > labelWidth * 2 + 12 ? format(viewport.start, major) : null, align: "start" });
  items.push({ id: "end", left: "100%", major: true, label: format(viewport.end, major), align: "end" });
  return items;
}
