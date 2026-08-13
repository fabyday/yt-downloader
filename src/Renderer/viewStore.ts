import { useSyncExternalStore } from "react";

export interface PresetFormatViewItem {
  id: string;
  meta: string;
  name: string;
}

export interface SegmentViewItem {
  color: string;
  duration: string;
  id: number;
  times: string;
  title: string;
}

export interface DownloadSegmentViewItem {
  color: string;
  duration: string;
  id: string;
  sourceSegmentId: number | null;
  times: string;
  title: string;
}

export interface TimelineSegmentViewItem {
  color: string;
  highlighted: boolean;
  id: string;
  left: string;
  pulseRevision: number;
  width: string;
}

export interface TimelineRulerViewItem {
  id: string;
  label: string | null;
  left: string;
  major: boolean;
}

export interface QueueViewItem {
  canPause: boolean;
  canRemove: boolean;
  canResume: boolean;
  editing: boolean;
  id: string;
  message: string;
  meta: string;
  outputPath: string | null;
  progress: number;
  selected: boolean;
  status: string;
  statusLabel: string;
  title: string;
}

interface RendererViewSnapshot {
  downloadSegmentItems: readonly DownloadSegmentViewItem[];
  downloadSegmentSummary: { count: number; duration: string };
  presetDetails: { meta: string; title: string };
  presetFormats: readonly PresetFormatViewItem[];
  queueItems: readonly QueueViewItem[];
  segmentItems: readonly SegmentViewItem[];
  timelineRulerItems: readonly TimelineRulerViewItem[];
  timelineSegments: readonly TimelineSegmentViewItem[];
}

interface RendererViewActions {
  clearQueue: () => void;
  focusDownloadSegment: (segmentId: number | null) => void;
  openOutput: (outputPath: string) => void;
  pauseQueueItem: (itemId: string) => void;
  previewSegment: (segmentId: number) => void;
  removeQueueItem: (itemId: string) => void;
  removeSelectedQueueItems: () => void;
  removeSegment: (segmentId: number) => void;
  resumeQueueItem: (itemId: string) => void;
  restoreQueueItem: (itemId: string) => void;
  selectAllQueueItems: () => void;
  toggleQueueItemSelection: (itemId: string) => void;
}

let snapshot: RendererViewSnapshot = {
  downloadSegmentItems: [],
  downloadSegmentSummary: { count: 0, duration: "00:00.000" },
  presetDetails: { meta: "", title: "" },
  presetFormats: [],
  queueItems: [],
  segmentItems: [],
  timelineRulerItems: [],
  timelineSegments: [],
};

let actions: RendererViewActions = {
  clearQueue: () => {},
  focusDownloadSegment: () => {},
  openOutput: () => {},
  pauseQueueItem: () => {},
  previewSegment: () => {},
  removeQueueItem: () => {},
  removeSelectedQueueItems: () => {},
  removeSegment: () => {},
  resumeQueueItem: () => {},
  restoreQueueItem: () => {},
  selectAllQueueItems: () => {},
  toggleQueueItemSelection: () => {},
};

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function updateSnapshot(partial: Partial<RendererViewSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  emitChange();
}

export function configureRendererViewActions(
  nextActions: Partial<RendererViewActions>,
): void {
  actions = { ...actions, ...nextActions };
}

export function getRendererViewActions(): RendererViewActions {
  return actions;
}

export function setPresetDetails(
  details: RendererViewSnapshot["presetDetails"],
): void {
  updateSnapshot({ presetDetails: details });
}

export function setDownloadSegmentViewItems(
  items: readonly DownloadSegmentViewItem[],
  summary: RendererViewSnapshot["downloadSegmentSummary"],
): void {
  updateSnapshot({ downloadSegmentItems: items, downloadSegmentSummary: summary });
}

export function setPresetFormats(
  formats: readonly PresetFormatViewItem[],
): void {
  updateSnapshot({ presetFormats: formats });
}

export function setQueueViewItems(items: readonly QueueViewItem[]): void {
  updateSnapshot({ queueItems: items });
}

export function setSegmentViewItems(items: readonly SegmentViewItem[]): void {
  updateSnapshot({ segmentItems: items });
}

export function setTimelineSegmentViewItems(
  items: readonly TimelineSegmentViewItem[],
): void {
  updateSnapshot({ timelineSegments: items });
}

export function setTimelineRulerViewItems(
  items: readonly TimelineRulerViewItem[],
): void {
  updateSnapshot({ timelineRulerItems: items });
}

export function useRendererViewSnapshot(): RendererViewSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
