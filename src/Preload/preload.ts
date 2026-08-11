import { contextBridge, ipcRenderer } from "electron";
import type { DownloadProgress, YtClipperApi } from "../Shared/types";

const api: YtClipperApi = {
  getDependencyStatus: () => ipcRenderer.invoke("app:get-dependency-status"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
  downloadSection: (payload) => ipcRenderer.invoke("download:section", payload),
  cancelDownload: (jobId) => ipcRenderer.invoke("download:cancel", jobId),
  releaseDownloadCache: (resumeKey) =>
    ipcRenderer.invoke("download:release-cache", resumeKey),
  loadQueueState: () => ipcRenderer.invoke("queue:load-state"),
  saveQueueState: (serialized) =>
    ipcRenderer.invoke("queue:save-state", serialized),
  saveQueueStateSync: (serialized) =>
    ipcRenderer.sendSync("queue:save-state-sync", serialized),
  openOutput: (filePath) => ipcRenderer.invoke("download:open-output", filePath),
  onDownloadProgress: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadProgress) =>
      handler(payload);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.off("download:progress", listener);
  }
};

contextBridge.exposeInMainWorld("ytClipper", api);
