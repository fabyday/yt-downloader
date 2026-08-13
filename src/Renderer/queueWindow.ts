import type {
  DownloadQueueItem,
  DownloadQueueStatus,
} from "../Shared/types";
import {
  LOCALE_CHANGE_EVENT,
  translate as t,
} from "./i18n";
import {
  configureRendererViewActions,
  setQueueViewItems,
} from "./viewStore";

interface QueueWindowElements {
  logOutput: HTMLPreElement;
  openOutputButton: HTMLButtonElement;
  progressFill: HTMLElement;
  progressLabel: HTMLElement;
  queueList: HTMLElement;
  queueSummary: HTMLElement;
}

let queueItems: DownloadQueueItem[] = [];
let lastOutputPath: string | null = null;
let selectedItemIds = new Set<string>();
let elements: QueueWindowElements;

export async function initializeQueueWindow(): Promise<void> {
  elements = collectElements();
  configureRendererViewActions({
    clearQueue: () => {
      void clearQueue();
    },
    openOutput: (outputPath) => {
      void window.ytClipper.openOutput(outputPath);
    },
    previewSegment: () => {},
    pauseQueueItem: (itemId) => {
      void pauseQueueItem(itemId);
    },
    removeQueueItem: (itemId) => {
      void removeQueueItem(itemId);
    },
    removeSegment: () => {},
    removeSelectedQueueItems: () => {
      void removeSelectedQueueItems();
    },
    resumeQueueItem: (itemId) => {
      void resumeQueueItem(itemId);
    },
    restoreQueueItem: () => {},
    selectAllQueueItems: () => {
      selectedItemIds = new Set(queueItems.map((item) => item.id));
      renderQueue();
    },
    toggleQueueItemSelection: (itemId) => {
      selectedItemIds.has(itemId)
        ? selectedItemIds.delete(itemId)
        : selectedItemIds.add(itemId);
      renderQueue();
    },
  });
  elements.openOutputButton.addEventListener("click", () => {
    if (lastOutputPath) void window.ytClipper.openOutput(lastOutputPath);
  });
  window.ytClipper.onDownloadQueueChanged(applyQueueSnapshot);
  window.addEventListener(LOCALE_CHANGE_EVENT, renderQueue);

  try {
    applyQueueSnapshot(await window.ytClipper.getDownloadQueue());
  } catch {
    elements.progressLabel.textContent = t("status.queueLoadFailed");
  }
}

function collectElements(): QueueWindowElements {
  return {
    logOutput: getElement<HTMLPreElement>("#logOutput"),
    openOutputButton: getElement<HTMLButtonElement>("#openOutputButton"),
    progressFill: getElement<HTMLElement>("#progressFill"),
    progressLabel: getElement<HTMLElement>("#progressLabel"),
    queueList: getElement<HTMLElement>("#queueList"),
    queueSummary: getElement<HTMLElement>("#queueSummary"),
  };
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required queue element not found: ${selector}`);
  return element;
}

function applyQueueSnapshot(items: DownloadQueueItem[]): void {
  queueItems = items;
  const availableIds = new Set(items.map((item) => item.id));
  selectedItemIds = new Set(
    [...selectedItemIds].filter((itemId) => availableIds.has(itemId)),
  );
  renderQueue();
}

function renderQueue(): void {
  const runningCount = queueItems.filter((item) => item.status === "running").length;
  const queuedCount = queueItems.filter((item) => item.status === "queued").length;
  elements.queueSummary.textContent =
    runningCount > 0
      ? t("queue.runningSummary", { running: runningCount, queued: queuedCount })
      : t("queue.waitingSummary", { queued: queuedCount });
  elements.queueList.classList.toggle("empty", queueItems.length === 0);
  setQueueViewItems(
    queueItems.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      statusLabel: getQueueStatusLabel(item.status),
      editing: false,
      progress: clampProgress(item.progress),
      meta: t("queue.meta", {
        completed: item.completedSegmentKeys.length,
        total: item.segmentsCount,
        quality: getQualityLabel(item),
        preset: item.presetName,
        speed: item.speedLabel,
      }),
      message: item.message || getQueueStatusLabel(item.status),
      outputPath: item.outputPath,
      canPause: item.status === "queued" || item.status === "running",
      canRemove: true,
      canResume: item.status === "paused" || item.status === "error",
      selected: selectedItemIds.has(item.id),
    })),
  );
  renderActiveProgress();
}

async function removeQueueItem(itemId: string): Promise<void> {
  if (!queueItems.some((candidate) => candidate.id === itemId)) return;
  applyQueueSnapshot(await window.ytClipper.removeQueuedDownload(itemId));
}

async function removeSelectedQueueItems(): Promise<void> {
  if (selectedItemIds.size === 0) return;
  applyQueueSnapshot(
    await window.ytClipper.removeQueuedDownloads([...selectedItemIds]),
  );
}

async function clearQueue(): Promise<void> {
  applyQueueSnapshot(await window.ytClipper.clearDownloadQueue());
}

async function pauseQueueItem(itemId: string): Promise<void> {
  applyQueueSnapshot(await window.ytClipper.pauseQueuedDownload(itemId));
}

async function resumeQueueItem(itemId: string): Promise<void> {
  applyQueueSnapshot(await window.ytClipper.resumeQueuedDownload(itemId));
}

function renderActiveProgress(): void {
  const item =
    queueItems.find((candidate) => candidate.status === "running") ??
    [...queueItems].reverse().find((candidate) => candidate.status !== "queued") ??
    queueItems.at(-1) ??
    null;
  if (!item) {
    setProgress(0);
    elements.progressLabel.textContent = t("status.idle");
    elements.logOutput.textContent = "";
    elements.openOutputButton.disabled = true;
    lastOutputPath = null;
    return;
  }

  setProgress(item.progress);
  elements.progressLabel.textContent = item.message || getQueueStatusLabel(item.status);
  elements.logOutput.textContent = item.log.join("\n");
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  lastOutputPath = item.outputPath || item.outputPaths?.[0] || null;
  elements.openOutputButton.disabled = !lastOutputPath;
}

function setProgress(value: number): void {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  elements.progressFill.style.width = `${percent}%`;
  elements.progressFill.parentElement?.setAttribute("aria-valuenow", String(percent));
}

function getQualityLabel(item: DownloadQueueItem): string {
  return item.payload.downloadQuality === "best"
    ? t("quality.best")
    : t("quality.max", { height: item.payload.downloadQuality });
}

function getQueueStatusLabel(status: DownloadQueueStatus): string {
  return t(`queue.status.${status}`);
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
