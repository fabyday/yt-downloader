import { app } from "electron";
import * as path from "node:path";
import {
  findDownloaderDeepLink,
  DOWNLOADER_PROTOCOLS,
} from "./ExternalProtocol";
import { ApplicationManager } from "./Manager/ApplicationManager";
import { readHardwareAccelerationPreference } from "./HardwareAcceleration";

// Keep existing preferences, cookies and queue data across the display-name change.
app.setPath("userData", path.join(app.getPath("appData"),
  app.isPackaged ? "YT Section Downloader" : "yt-section-downloader"));
app.setName("kawai-downloader");

// Electron requires this setting before ready; saved changes apply next launch.
if (!readHardwareAccelerationPreference(app.getPath("userData"))) {
  app.disableHardwareAcceleration();
}

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
  for (const protocol of DOWNLOADER_PROTOCOLS) {
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient(protocol);
    }
  }
}
