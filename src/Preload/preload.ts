import { contextBridge, ipcRenderer } from "electron";
import type {
  AppPreferences,
  BrowserTabSnapshot,
  DownloadQueueItem,
  YtClipperApi,
} from "../Shared/types";

const api: YtClipperApi = {
  resolvePreview: (videoId) => ipcRenderer.invoke("preview:resolve", videoId),
  onCookiesChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, status: import("../Shared/types").CookieStatus) => handler(status);
    ipcRenderer.on("cookies:changed", listener);
    return () => ipcRenderer.off("cookies:changed", listener);
  },
  getCookieStatus: () => ipcRenderer.invoke("cookies:status"),
  requestCookieAccess: (options) => ipcRenderer.invoke("cookies:request-access", options),
  openCookiePermissionSettings: (target) => ipcRenderer.invoke("cookies:open-permissions", target),
  getBrowserCookieStatus: (options) => ipcRenderer.invoke("cookies:browser-status", options),
  getBrowserProfiles: (options) => ipcRenderer.invoke("cookies:profiles", options),
  importCookies: (site) => ipcRenderer.invoke("cookies:import", site),
  importBrowserCookies: (options) => ipcRenderer.invoke("cookies:import-browser", options),
  clearCookies: (site) => ipcRenderer.invoke("cookies:clear", site),
  getYtDlpUpdateStatus: () => ipcRenderer.invoke("app:yt-dlp-update-status"),
  checkYtDlpUpdate: () => ipcRenderer.invoke("app:yt-dlp-update-check"),
  getDependencyStatus: () => ipcRenderer.invoke("app:get-dependency-status"),
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-updates"),
  openExternalUrl: (url) => ipcRenderer.invoke("app:open-external", url),
  selectOutputDir: (locale) =>
    ipcRenderer.invoke("dialog:select-output-dir", locale),
  enqueueDownload: (item) => ipcRenderer.invoke("queue:enqueue", item),
  updateQueuedDownload: (item) => ipcRenderer.invoke("queue:update", item),
  getDownloadQueue: () => ipcRenderer.invoke("queue:get"),
  removeQueuedDownload: (itemId) => ipcRenderer.invoke("queue:remove", itemId),
  removeQueuedDownloads: (itemIds) =>
    ipcRenderer.invoke("queue:remove-many", itemIds),
  clearDownloadQueue: () => ipcRenderer.invoke("queue:clear"),
  pauseQueuedDownload: (itemId) => ipcRenderer.invoke("queue:pause", itemId),
  resumeQueuedDownload: (itemId) => ipcRenderer.invoke("queue:resume", itemId),
  cancelDownload: (jobId) => ipcRenderer.invoke("download:cancel", jobId),
  openOutput: (filePath) => ipcRenderer.invoke("download:open-output", filePath),
  getBrowserTabs: () => ipcRenderer.invoke("tabs:get"),
  createBrowserTab: () => ipcRenderer.invoke("tabs:create"),
  activateBrowserTab: (tabId) => ipcRenderer.invoke("tabs:activate", tabId),
  closeBrowserTab: (tabId) => ipcRenderer.invoke("tabs:close", tabId),
  updateBrowserTabTitle: (title) =>
    ipcRenderer.invoke("tabs:update-title", title),
  openQueueWindow: () => ipcRenderer.invoke("window:open-queue"),
  getPreferences: () => ipcRenderer.invoke("preference:get"),
  updatePreferences: (preferences) =>
    ipcRenderer.invoke("preference:update", preferences),
  onBrowserTabsChanged: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: BrowserTabSnapshot,
    ) => handler(payload);
    ipcRenderer.on("tabs:changed", listener);
    return () => ipcRenderer.off("tabs:changed", listener);
  },
  onDownloadQueueChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadQueueItem[]) =>
      handler(payload);
    ipcRenderer.on("queue:changed", listener);
    return () => ipcRenderer.off("queue:changed", listener);
  },
  onPreferencesChanged: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: AppPreferences,
    ) => handler(payload);
    ipcRenderer.on("preference:changed", listener);
    return () => ipcRenderer.off("preference:changed", listener);
  }
};

contextBridge.exposeInMainWorld("ytClipper", api);
