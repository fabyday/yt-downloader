import type {
  DownloadProgress,
  DownloadQueueItem,
  DownloadQueueStatus,
  DownloadRequest,
  DownloadResult,
  DownloadSegment,
} from "../Shared/types";
import { translate as t } from "../Shared/nodeI18n";

const QUEUE_LOG_LIMIT = 120;

interface DownloadQueueServiceOptions {
  cancel: (jobId: string) => { canceled: boolean };
  execute: (
    request: DownloadRequest,
    onProgress: (progress: DownloadProgress) => void,
  ) => Promise<DownloadResult>;
  load: () => Promise<string | null>;
  notify: (items: DownloadQueueItem[]) => void;
  releaseCache: (resumeKey: string) => Promise<void>;
  save: (serialized: string) => Promise<void>;
}

export class DownloadQueueService {
  private readonly options: DownloadQueueServiceOptions;
  private items: DownloadQueueItem[] = [];
  private running = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private runnerPromise: Promise<void> | null = null;
  private stopping = false;
  private readonly pauseRequested = new Set<string>();
  private readonly removalRequested = new Set<string>();
  private readonly cancelIssued = new Set<string>();

  constructor(options: DownloadQueueServiceOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    const serialized = await this.options.load();
    this.items = hydrateQueue(serialized);
    this.publish();
    this.startRunner();
  }

  getSnapshot(): DownloadQueueItem[] {
    return cloneItems(this.items);
  }

  async enqueue(item: DownloadQueueItem): Promise<DownloadQueueItem[]> {
    if (!this.items.some((candidate) => candidate.id === item.id)) {
      this.items.push(normalizeIncomingItem(item));
    }
    this.publish();
    this.startRunner();
    return this.getSnapshot();
  }

  async update(item: DownloadQueueItem): Promise<DownloadQueueItem[]> {
    const index = this.items.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) {
      return this.enqueue(item);
    }

    const current = this.items[index];
    const incoming = normalizeIncomingItem(item);
    this.items[index] = {
      ...incoming,
      status: current.status === "running" ? "running" : incoming.status,
      progress: current.progress,
      outputPath: current.outputPath,
      outputPaths: [...current.outputPaths],
      completedSegmentKeys: [...current.completedSegmentKeys],
      currentAttemptKeys: [...current.currentAttemptKeys],
      jobId: current.jobId,
      log: incoming.log.length > 0 ? incoming.log : [...current.log],
    };
    this.publish();
    this.startRunner();
    return this.getSnapshot();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    await this.runnerPromise?.catch(() => {});
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
  }

  async remove(itemId: string): Promise<DownloadQueueItem[]> {
    return this.removeMany([itemId]);
  }

  async removeMany(itemIds: string[]): Promise<DownloadQueueItem[]> {
    const targets = new Set(itemIds.filter(Boolean));
    const removable = this.items.filter(
      (item) => targets.has(item.id) && item.status !== "running",
    );

    for (const item of this.items) {
      if (!targets.has(item.id) || item.status !== "running") continue;
      this.pauseRequested.add(item.id);
      this.removalRequested.add(item.id);
      item.message = t(item.payload.locale, "queue.message.removing");
      this.requestCancel(item);
    }

    if (removable.length > 0) {
      const removableIds = new Set(removable.map((item) => item.id));
      this.items = this.items.filter((item) => !removableIds.has(item.id));
      await Promise.all(
        removable.map((item) => this.options.releaseCache(item.id).catch(() => {})),
      );
    }

    await this.persist();
    this.options.notify(this.getSnapshot());
    return this.getSnapshot();
  }

  async clear(): Promise<DownloadQueueItem[]> {
    return this.removeMany(this.items.map((item) => item.id));
  }

  async pause(itemId: string): Promise<DownloadQueueItem[]> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item || item.status === "done" || item.status === "paused") {
      return this.getSnapshot();
    }

    if (item.status === "running") {
      this.pauseRequested.add(item.id);
      item.message = t(item.payload.locale, "queue.message.pausing");
      this.requestCancel(item);
    } else {
      item.status = "paused";
      item.error = null;
      item.message = t(item.payload.locale, "queue.message.paused");
    }
    this.publish();
    return this.getSnapshot();
  }

  async resume(itemId: string): Promise<DownloadQueueItem[]> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item || (item.status !== "paused" && item.status !== "error")) {
      return this.getSnapshot();
    }

    this.pauseRequested.delete(item.id);
    this.removalRequested.delete(item.id);
    item.status = "queued";
    item.error = null;
    item.message = t(item.payload.locale, "queue.message.resumeQueued");
    this.publish();
    this.startRunner();
    return this.getSnapshot();
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        const item = this.items.find((candidate) => candidate.status === "queued");
        if (!item) {
          break;
        }

        const pendingSegments = getPendingSegments(item);
        if (pendingSegments.length === 0) {
          item.status = "done";
          item.progress = 1;
          item.message = t(item.payload.locale, "queue.message.completed");
          this.publish();
          continue;
        }

        item.status = "running";
        item.currentAttemptKeys = pendingSegments.map((segment) => segment.key);
        item.progress = getCompletedProgress(item);
        item.message =
          item.completedSegmentKeys.length > 0
            ? t(item.payload.locale, "queue.message.resume")
            : t(item.payload.locale, "queue.message.starting");
        item.error = null;
        item.log = [t(item.payload.locale, "log.downloadStarted")];
        this.publish();

        try {
          const result = await this.options.execute(
            {
              ...item.payload,
              resumeKey: item.id,
              skipSegmentKeys: [...item.completedSegmentKeys],
              keepSourceCache: true,
            },
            (progress) => this.handleProgress(item.id, progress),
          );

          if (this.pauseRequested.has(item.id)) {
            if (result.ok) {
              for (const completed of result.completedSegments || []) {
                markSegmentCompleted(item, completed.key, completed.outputPath);
              }
              for (const outputPath of result.outputPaths || []) {
                if (!item.outputPaths.includes(outputPath)) {
                  item.outputPaths.push(outputPath);
                }
              }
              item.outputPath = result.outputPath || item.outputPaths[0] || item.outputPath;
            }
            const remaining = getPendingSegments(item);
            item.status = remaining.length > 0 ? "paused" : "done";
            item.progress = getCompletedProgress(item);
            item.error = null;
            item.message =
              item.status === "done"
                ? t(item.payload.locale, "queue.message.completed")
                : t(item.payload.locale, "queue.message.paused");
            appendLog(item, `[pause] ${item.message}`);
          } else if (result.ok) {
            for (const completed of result.completedSegments || []) {
              markSegmentCompleted(item, completed.key, completed.outputPath);
            }
            if ((result.completedSegments || []).length === 0) {
              for (const key of item.currentAttemptKeys) {
                markSegmentCompleted(item, key);
              }
            }

            for (const outputPath of result.outputPaths || []) {
              if (!item.outputPaths.includes(outputPath)) {
                item.outputPaths.push(outputPath);
              }
            }
            item.outputPath = result.outputPath || item.outputPaths[0] || item.outputPath;
            const remaining = getPendingSegments(item);
            item.status = remaining.length > 0 ? "queued" : "done";
            item.progress = getCompletedProgress(item);
            item.message =
              remaining.length > 0
                ? t(item.payload.locale, "queue.message.remaining", {
                    count: remaining.length,
                  })
                : t(item.payload.locale, "queue.message.filesCreated", {
                    count: item.outputPaths.length,
                  });
            appendLog(item, `[done] ${item.message}`);
          } else {
            const message = result.error || t(item.payload.locale, "queue.message.failed");
            item.status = "error";
            item.error = message;
            item.message = message;
            appendLog(item, `[error] ${message}`);
          }
        } catch (error) {
          if (this.pauseRequested.has(item.id)) {
            item.status = "paused";
            item.error = null;
            item.message = t(item.payload.locale, "queue.message.paused");
            appendLog(item, `[pause] ${item.message}`);
          } else {
            const message = getErrorMessage(error) || t(item.payload.locale, "queue.message.failed");
            item.status = "error";
            item.error = message;
            item.message = message;
            appendLog(item, `[error] ${message}`);
          }
        }

        const completedJobId = item.jobId;
        item.currentAttemptKeys = [];
        item.jobId = null;
        this.pauseRequested.delete(item.id);
        if (completedJobId) this.cancelIssued.delete(completedJobId);
        if (this.removalRequested.delete(item.id)) {
          this.items = this.items.filter((candidate) => candidate.id !== item.id);
          await this.options.releaseCache(item.id).catch(() => {});
        }
        this.publish();
      }
    } finally {
      this.running = false;
      this.publish();
    }
  }

  private startRunner(): void {
    if (this.stopping || this.runnerPromise) {
      return;
    }

    this.runnerPromise = this.run().finally(() => {
      this.runnerPromise = null;
      if (!this.stopping && this.items.some((item) => item.status === "queued")) {
        this.startRunner();
      }
    });
  }

  private handleProgress(itemId: string, progress: DownloadProgress): void {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    item.jobId = progress.jobId || item.jobId;
    this.requestCancel(item);
    if (progress.stage === "segment-done" && progress.segmentKey) {
      markSegmentCompleted(item, progress.segmentKey, progress.outputPath);
    } else if (progress.progress !== undefined) {
      const completedWeight = item.completedSegmentKeys.length;
      const attemptWeight = item.currentAttemptKeys.length;
      item.progress = clampProgress(
        (completedWeight + progress.progress * attemptWeight) /
          Math.max(1, item.payload.segments.length),
      );
    }

    if (progress.message) {
      item.message = progress.message;
      appendLog(item, `[${progress.stage || "progress"}] ${progress.message}`);
    }
    if (progress.outputPath) {
      item.outputPath = progress.outputPath;
    }
    this.publish(false);
  }

  private requestCancel(item: DownloadQueueItem): void {
    if (
      !this.pauseRequested.has(item.id) ||
      !item.jobId ||
      this.cancelIssued.has(item.jobId)
    ) {
      return;
    }
    this.cancelIssued.add(item.jobId);
    this.options.cancel(item.jobId);
  }

  private publish(persistImmediately = true): void {
    this.options.notify(this.getSnapshot());
    if (persistImmediately) {
      void this.persist();
      return;
    }

    if (this.persistTimer === null) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        void this.persist();
      }, 200);
    }
  }

  private async persist(): Promise<void> {
    await this.options.save(
      JSON.stringify({ version: 2, items: this.items }),
    );
  }
}

function normalizeIncomingItem(item: DownloadQueueItem): DownloadQueueItem {
  const segments = item.payload.segments.map(normalizeSegmentKey);
  return {
    ...item,
    payload: {
      ...item.payload,
      segments,
      resumeKey: item.id,
      keepSourceCache: true,
    },
    segmentsCount: segments.length,
    status: item.status === "running" ? "queued" : item.status,
    progress: clampProgress(item.progress),
    outputPaths: [...(item.outputPaths || [])],
    completedSegmentKeys: [...(item.completedSegmentKeys || [])],
    currentAttemptKeys: [],
    log: [...(item.log || [])].slice(-QUEUE_LOG_LIMIT),
  };
}

function hydrateQueue(serialized: string | null): DownloadQueueItem[] {
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized) as { items?: unknown[] };
    return (Array.isArray(parsed.items) ? parsed.items : [])
      .map(hydrateItem)
      .filter((item): item is DownloadQueueItem => item !== null);
  } catch {
    return [];
  }
}

function hydrateItem(value: unknown): DownloadQueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<DownloadQueueItem>;
  if (!item.id || !item.payload || !Array.isArray(item.payload.segments)) {
    return null;
  }

  const segments = item.payload.segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .map(normalizeSegmentKey);
  if (segments.length === 0) {
    return null;
  }

  const segmentKeys = new Set(segments.map((segment) => segment.key));
  const completedSegmentKeys = (item.completedSegmentKeys || []).filter((key) =>
    segmentKeys.has(key),
  );
  const rawStatus = isQueueStatus(item.status) ? item.status : "queued";
  const status = rawStatus === "running" ? "queued" : rawStatus;
  const locale = item.payload.locale;

  return normalizeIncomingItem({
    id: item.id,
    payload: { ...item.payload, segments },
    title: item.title || item.payload.basename || t(locale, "queue.defaultTitle"),
    segmentsCount: segments.length,
    presetName: item.presetName || item.payload.encodingPreset,
    qualityLabel: item.qualityLabel || item.payload.downloadQuality,
    speedLabel: item.speedLabel || t(locale, "speed.noLimit"),
    status: completedSegmentKeys.length === segments.length ? "done" : status,
    progress: completedSegmentKeys.length / segments.length,
    message:
      rawStatus === "running"
        ? t(locale, "queue.message.resumeAfterRestart")
        : item.message || t(locale, "queue.message.waiting"),
    outputPath: item.outputPath || null,
    outputPaths: item.outputPaths || [],
    error: item.error || null,
    jobId: null,
    log: item.log || [],
    completedSegmentKeys,
    currentAttemptKeys: [],
    editorSnapshot: item.editorSnapshot || {
      startTime: segments[0].start,
      endTime: segments[0].end,
      rangeIsDefault: false,
      segments,
    },
  });
}

function normalizeSegmentKey(segment: DownloadSegment): DownloadSegment & { key: string } {
  return {
    start: Number(segment.start),
    end: Number(segment.end),
    key: segment.key || createSegmentKey(segment.start, segment.end),
  };
}

function createSegmentKey(start: number, end: number): string {
  return `${Number(start).toFixed(3)}-${Number(end).toFixed(3)}`;
}

function getPendingSegments(item: DownloadQueueItem) {
  const completed = new Set(item.completedSegmentKeys);
  return item.payload.segments
    .map(normalizeSegmentKey)
    .filter((segment) => !completed.has(segment.key));
}

function markSegmentCompleted(
  item: DownloadQueueItem,
  key: string,
  outputPath?: string,
): void {
  if (!item.completedSegmentKeys.includes(key)) {
    item.completedSegmentKeys.push(key);
  }
  if (outputPath && !item.outputPaths.includes(outputPath)) {
    item.outputPaths.push(outputPath);
    item.outputPath = outputPath;
  }
  item.progress = getCompletedProgress(item);
}

function getCompletedProgress(item: DownloadQueueItem): number {
  return clampProgress(
    item.completedSegmentKeys.length / Math.max(1, item.payload.segments.length),
  );
}

function appendLog(item: DownloadQueueItem, line: string): void {
  item.log = [...item.log, line].slice(-QUEUE_LOG_LIMIT);
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function isQueueStatus(value: unknown): value is DownloadQueueStatus {
  return ["queued", "running", "paused", "done", "error"].includes(String(value));
}

function cloneItems(items: DownloadQueueItem[]): DownloadQueueItem[] {
  return JSON.parse(JSON.stringify(items)) as DownloadQueueItem[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
