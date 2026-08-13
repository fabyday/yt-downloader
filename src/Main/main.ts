import { app } from "electron";
import * as path from "node:path";
import {
  findDownloaderDeepLink,
  YT_DOWNLOADER_PROTOCOL,
} from "./ExternalProtocol";
import { ApplicationManager } from "./Manager/ApplicationManager";

// Keep video frames in Chromium's software-composited surface so macOS page
// and window captures can include them instead of losing a GPU overlay layer.
// Electron requires this to run before the app becomes ready.
app.disableHardwareAcceleration();

const applicationManager = new ApplicationManager();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerProtocolClient();

  app.on("open-url", (event, url) => {
    event.preventDefault();
    applicationManager.openExternalUrl(url);
  });
  app.on("second-instance", (_event, argv) => {
    const deepLink = findDownloaderDeepLink(argv);
    if (deepLink) applicationManager.openExternalUrl(deepLink);
    applicationManager.focusMainWindow();
  });

  const initialDeepLink = findDownloaderDeepLink(process.argv);
  if (initialDeepLink) applicationManager.openExternalUrl(initialDeepLink);
  applicationManager.registerLifecycle();
}

function registerProtocolClient(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(YT_DOWNLOADER_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    return;
  }
  app.setAsDefaultProtocolClient(YT_DOWNLOADER_PROTOCOL);
}
