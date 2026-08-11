const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ytClipper", {
  getDependencyStatus: () => ipcRenderer.invoke("app:get-dependency-status"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
  downloadSection: (payload) => ipcRenderer.invoke("download:section", payload),
  cancelDownload: (jobId) => ipcRenderer.invoke("download:cancel", jobId),
  openOutput: (filePath) => ipcRenderer.invoke("download:open-output", filePath),
  onDownloadProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.off("download:progress", listener);
  }
});
