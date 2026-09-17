import { app, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { normalizeLocale } from "../../Shared/locale";
import { translate as t } from "../../Shared/nodeI18n";
import { YT_DLP_UPDATE_TIMEOUT_MS } from "../../Shared/dependencies";
import type { DownloadQueueItem } from "../../Shared/types";
import type { AppPreferences } from "../../Shared/types";
import { BaseManager } from "./BaseManager";
import { IpcReturnType } from "./ReturnTypes";
import { WindowManager } from "./WindowManager";
import { WorkerManager } from "./WorkerManager";
import { PreferenceManager } from "./PreferenceManager";
import { UpdateManager } from "./UpdateManager";

const IPC_CHANNELS = [
  "app:get-dependency-status",
  "app:get-info",
  "app:check-updates",
  "app:open-external",
  "dialog:select-output-dir",
  "download:open-output",
  "download:cancel",
  "queue:get",
  "queue:enqueue",
  "queue:update",
  "queue:remove",
  "queue:remove-many",
  "queue:clear",
  "queue:pause",
  "queue:resume",
  "tabs:get",
  "tabs:create",
  "tabs:activate",
  "tabs:close",
  "tabs:update-title",
  "window:open-queue",
  "preference:get",
  "preference:update",
] as const;

export class IPCManager extends BaseManager<IpcReturnType> {
  private initialized = false;
  private removeQueueListener: (() => void) | null = null;

  constructor(
    private readonly workerManager: WorkerManager,
    private readonly windowManager: WindowManager,
    private readonly preferenceManager: PreferenceManager,
    private readonly updateManager: UpdateManager,
  ) {
    super();
  }

  async initialize(): Promise<ReturnCode<IpcReturnType>> {
    if (this.initialized) {
      return successReturnCode(
        IpcReturnType.Initialized,
        "IPC manager is already initialized",
      );
    }

    try {
      this.registerHandlers();
      this.removeQueueListener = this.workerManager.onQueueChanged((items) => {
        this.windowManager.broadcast("queue:changed", items);
      });
      this.initialized = true;
      return successReturnCode(
        IpcReturnType.Initialized,
        "IPC manager initialized",
      );
    } catch (error) {
      this.removeHandlers();
      return failureReturnCode(
        IpcReturnType.InitializationFailed,
        "IPC manager initialization failed",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<IpcReturnType>> {
    this.removeQueueListener?.();
    this.removeQueueListener = null;
    this.removeHandlers();
    this.initialized = false;
    return successReturnCode(
      IpcReturnType.Finalized,
      "IPC manager finalized",
    );
  }

  private registerHandlers(): void {
    ipcMain.handle("app:get-dependency-status", () =>
      this.workerManager.getClient().request("dependency.get", {}, YT_DLP_UPDATE_TIMEOUT_MS + 15_000),
    );
    ipcMain.handle("app:get-info", () => ({
      arch: process.arch,
      name: app.getName(),
      platform: process.platform,
      version: app.getVersion(),
    }));
    ipcMain.handle("app:check-updates", async () => {
      const currentVersion = app.getVersion();
      const result = await this.updateManager.checkForUpdates(currentVersion);
      return result.ok
        ? result.data
        : {
            currentVersion,
            latestVersion: null,
            message: result.detail || result.message,
            releaseUrl: null,
            status: "error" as const,
          };
    });
    ipcMain.handle(
      "app:open-external",
      async (_event: IpcMainInvokeEvent, value: string) => {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        await shell.openExternal(url.toString());
        return true;
      },
    );

    ipcMain.handle("dialog:select-output-dir", async (_event, localeValue) => {
      const locale = normalizeLocale(localeValue || app.getLocale());
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: t(locale, "main.dialog.outputFolder"),
      });
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0];
    });

    ipcMain.handle(
      "download:open-output",
      async (_event: IpcMainInvokeEvent, filePath: string) => {
        if (!filePath) return false;
        shell.showItemInFolder(filePath);
        return true;
      },
    );

    ipcMain.handle(
      "download:cancel",
      (_event: IpcMainInvokeEvent, jobId: string) =>
        this.workerManager
          .getClient()
          .request("download.cancel", { jobId }),
    );
    ipcMain.handle("queue:get", () =>
      this.workerManager.getClient().request("queue.get", {}),
    );
    ipcMain.handle(
      "queue:enqueue",
      (_event: IpcMainInvokeEvent, item: DownloadQueueItem) =>
        this.workerManager.getClient().request("queue.enqueue", { item }),
    );
    ipcMain.handle(
      "queue:update",
      (_event: IpcMainInvokeEvent, item: DownloadQueueItem) =>
        this.workerManager.getClient().request("queue.update", { item }),
    );
    ipcMain.handle(
      "queue:remove",
      (_event: IpcMainInvokeEvent, itemId: string) =>
        this.workerManager.getClient().request("queue.remove", { itemId }),
    );
    ipcMain.handle(
      "queue:remove-many",
      (_event: IpcMainInvokeEvent, itemIds: string[]) =>
        this.workerManager.getClient().request("queue.removeMany", { itemIds }),
    );
    ipcMain.handle("queue:clear", () =>
      this.workerManager.getClient().request("queue.clear", {}),
    );
    ipcMain.handle(
      "queue:pause",
      (_event: IpcMainInvokeEvent, itemId: string) =>
        this.workerManager.getClient().request("queue.pause", { itemId }),
    );
    ipcMain.handle(
      "queue:resume",
      (_event: IpcMainInvokeEvent, itemId: string) =>
        this.workerManager.getClient().request("queue.resume", { itemId }),
    );

    ipcMain.handle("tabs:get", () => this.windowManager.getTabSnapshot());
    ipcMain.handle("tabs:create", () => this.windowManager.createTab());
    ipcMain.handle(
      "tabs:activate",
      (_event: IpcMainInvokeEvent, tabId: string) =>
        this.windowManager.activateTab(tabId),
    );
    ipcMain.handle(
      "tabs:close",
      (_event: IpcMainInvokeEvent, tabId: string) =>
        this.windowManager.closeTab(tabId),
    );
    ipcMain.handle(
      "tabs:update-title",
      (event: IpcMainInvokeEvent, title: string) =>
        this.windowManager.updateTabTitle(event.sender.id, title),
    );
    ipcMain.handle("window:open-queue", () => {
      this.windowManager.openQueueWindow();
      return true;
    });
    ipcMain.handle("preference:get", () =>
      this.preferenceManager.getPreferences(),
    );
    ipcMain.handle(
      "preference:update",
      async (_event: IpcMainInvokeEvent, updates: Partial<AppPreferences>) => {
        const preferences = await this.preferenceManager.updatePreferences(updates);
        this.windowManager.broadcast("preference:changed", preferences);
        return preferences;
      },
    );
  }

  private removeHandlers(): void {
    for (const channel of IPC_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
