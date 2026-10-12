import type { SupportedLocale } from "./locale";
import type { BrowserCookieOptions } from "./cookies";

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
  customFfmpegArgs?: string;
  customExtension?: string;
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
  shortcuts: import("./shortcuts").ShortcutBindings;
  hardwareAcceleration: boolean;
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
  isPackaged?: boolean;
  runtimeAppPath?: string | null;
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
  /** Kawaikara request that created this item, when launched as a companion. */
  companionRequestId?: string;
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

export interface CookieStatus {
  sites?: Partial<Record<import("./cookies").CookieSite, CookieStatus>>;
  loginCookiesPresent?: boolean;
  previewApplied?: boolean;
  previewCount?: number;
  previewError?: boolean;
  error?: "cookies.readFailed";
  configured: boolean;
  count: number;
}

export type PreviewResult = { ok: true; url: string; audioUrl?: string; title: string; videoId: string; transport?: "hls"; duration?: number }
  | { ok: false; error: "preview.expired" | "preview.denied" | "preview.unavailable" | "preview.failed" | "preview.liveUnsupported" };

export interface YtDlpUpdateStatus {
  status: "checking" | "downloading" | "current" | "updated" | "error" | "unavailable" | "managed";
  version: string | null;
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
  logMessage?: string;
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
  resolvePreview(videoId: string): Promise<PreviewResult>;
  onCookiesChanged(handler: (status: CookieStatus) => void): () => void;
  requestCookieAccess(options: BrowserCookieOptions): Promise<void>;
  openCookiePermissionSettings(target: "keychain" | "files"): Promise<void>;
  getBrowserCookieStatus(options: BrowserCookieOptions): Promise<import("./cookies").BrowserProcessStatus>;
  getBrowserProfiles(options: BrowserCookieOptions): Promise<import("./cookies").BrowserProfileList>;
  getCookieStatus(): Promise<CookieStatus>;
  importCookies(site?: import("./cookies").CookieSite): Promise<CookieStatus | null>;
  importBrowserCookies(options: BrowserCookieOptions): Promise<CookieStatus>;
  clearCookies(site?: import("./cookies").CookieSite): Promise<CookieStatus>;
  getYtDlpUpdateStatus(): Promise<YtDlpUpdateStatus>;
  checkYtDlpUpdate(): Promise<YtDlpUpdateStatus>;
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
