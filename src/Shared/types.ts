import type { SupportedLocale } from "./locale";

export interface DownloadSegment {
  start: number;
  end: number;
  key?: string;
}

export interface CompletedDownloadSegment {
  key: string;
  outputPath: string;
}

export interface DownloadRequest {
  locale?: SupportedLocale;
  url: string;
  segments: DownloadSegment[];
  downloadQuality: string;
  speedLimit: string;
  encodingPreset: string;
  basename: string;
  outputDir: string;
  resumeKey?: string;
  skipSegmentKeys?: string[];
  keepSourceCache?: boolean;
}

export type DownloadQueueStatus =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "error";

export interface AppPreferences {
  automaticUpdates: boolean;
  defaultDownloadQuality: string;
  defaultEncodingPreset: string;
  defaultOutputDir: string;
  defaultSpeedLimit: string;
  frameRate: number;
  locale: SupportedLocale;
  seekLargeSeconds: number;
  seekSmallSeconds: number;
}

export interface AppInfo {
  arch: string;
  name: string;
  platform: string;
  version: string;
}

export type AppUpdateStatus = "available" | "current" | "error";

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  message: string;
  releaseUrl: string | null;
  status: AppUpdateStatus;
}

export interface EditorSnapshot {
  startTime: number | null;
  endTime: number | null;
  rangeIsDefault: boolean;
  segments: DownloadSegment[];
}

export interface DownloadQueueItem {
  id: string;
  payload: DownloadRequest;
  title: string;
  segmentsCount: number;
  presetName: string;
  qualityLabel: string;
  speedLabel: string;
  status: DownloadQueueStatus;
  progress: number;
  message: string;
  outputPath: string | null;
  outputPaths: string[];
  error: string | null;
  jobId: string | null;
  log: string[];
  completedSegmentKeys: string[];
  currentAttemptKeys: string[];
  editorSnapshot: EditorSnapshot;
}

export interface DependencyStatus {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
  reason?: "missing" | "outdated";
  minimumVersion?: string;
}

export interface DependencyStatuses {
  ytDlp: DependencyStatus;
  ffmpeg: DependencyStatus;
}

export type RendererViewMode = "shell" | "editor" | "queue";

export interface BrowserTabState {
  id: string;
  title: string;
  active: boolean;
}

export interface BrowserTabSnapshot {
  activeTabId: string | null;
  tabs: BrowserTabState[];
}

export interface DownloadProgress {
  jobId: string;
  stage: string;
  message: string;
  progress?: number;
  segmentIndex?: number;
  segmentCount?: number;
  segmentKey?: string;
  outputPath?: string;
  outputPaths?: string[];
}

export interface DownloadResult {
  ok: boolean;
  jobId: string;
  outputPath?: string;
  outputPaths?: string[];
  completedSegments?: CompletedDownloadSegment[];
  error?: string;
}

export interface YtClipperApi {
  getDependencyStatus(): Promise<DependencyStatuses>;
  selectOutputDir(locale?: SupportedLocale): Promise<string | null>;
  enqueueDownload(item: DownloadQueueItem): Promise<DownloadQueueItem[]>;
  updateQueuedDownload(item: DownloadQueueItem): Promise<DownloadQueueItem[]>;
  getDownloadQueue(): Promise<DownloadQueueItem[]>;
  removeQueuedDownload(itemId: string): Promise<DownloadQueueItem[]>;
  removeQueuedDownloads(itemIds: string[]): Promise<DownloadQueueItem[]>;
  clearDownloadQueue(): Promise<DownloadQueueItem[]>;
  pauseQueuedDownload(itemId: string): Promise<DownloadQueueItem[]>;
  resumeQueuedDownload(itemId: string): Promise<DownloadQueueItem[]>;
  cancelDownload(jobId: string): Promise<{ canceled: boolean }>;
  openOutput(filePath: string): Promise<boolean>;
  getBrowserTabs(): Promise<BrowserTabSnapshot>;
  createBrowserTab(): Promise<BrowserTabSnapshot>;
  activateBrowserTab(tabId: string): Promise<BrowserTabSnapshot>;
  closeBrowserTab(tabId: string): Promise<BrowserTabSnapshot>;
  updateBrowserTabTitle(title: string): Promise<BrowserTabSnapshot>;
  openQueueWindow(): Promise<boolean>;
  getAppInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<AppUpdateInfo>;
  openExternalUrl(url: string): Promise<boolean>;
  getPreferences(): Promise<AppPreferences>;
  updatePreferences(preferences: Partial<AppPreferences>): Promise<AppPreferences>;
  onBrowserTabsChanged(handler: (snapshot: BrowserTabSnapshot) => void): () => void;
  onDownloadQueueChanged(handler: (items: DownloadQueueItem[]) => void): () => void;
  onPreferencesChanged(handler: (preferences: AppPreferences) => void): () => void;
}
