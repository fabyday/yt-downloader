import type { KawaikaraConnection } from "../KawaikaraConnection";
import { app, dialog, ipcMain, shell, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as fs from "node:fs/promises";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { normalizeLocale } from "../../Shared/locale";
import { translate as t } from "../../Shared/nodeI18n";
import { YT_DLP_UPDATE_TIMEOUT_MS } from "../../Shared/dependencies";
import { browserCookieSpec, COOKIE_IMPORT_TIMEOUT_MS, type BrowserCookieOptions } from "../../Shared/cookies";
import type { DownloadQueueItem } from "../../Shared/types";
import type { AppPreferences } from "../../Shared/types";
import { BaseManager } from "./BaseManager";
import { IpcReturnType } from "./ReturnTypes";
import { WindowManager } from "./WindowManager";
import { WorkerManager } from "./WorkerManager";
import { CompanionManager } from "./CompanionManager";
import { PreferenceManager } from "./PreferenceManager";
import { UpdateManager } from "./UpdateManager";
import { macAppBundleForExecutable, requestCookieKeychainAccess } from "../CookiePermission";
import { applyPreviewCookies, PREVIEW_PARTITION } from "../PreviewCookies";
import type { CookieStatus } from "../../Shared/types";
import { cookieSite } from "../../Shared/cookies";
import { previewSource } from "../../Shared/VideoSource";

const IPC_CHANNELS = [
  "preview:resolve",
  "cookies:request-access",
  "cookies:open-permissions",
  "cookies:browser-status",
  "cookies:profiles",
  "cookies:status",
  "cookies:import",
  "cookies:import-browser",
  "cookies:clear",
  "app:yt-dlp-update-status",
  "app:yt-dlp-update-check",
  "app:get-dependency-status",
  "app:get-info",
  "app:check-updates",
  "app:open-external",
  "app:open-kawaikara",
  "app:development-connection",
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
  private cookieStatus: CookieStatus = { configured: false, count: 0, previewApplied: false };
  private cookieOperations: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workerManager: WorkerManager,
    private readonly windowManager: WindowManager,
    private readonly preferenceManager: PreferenceManager,
    private readonly updateManager: UpdateManager,
    private readonly companionManager: CompanionManager,
    private readonly developmentConnection?: KawaikaraConnection,
  ) {
    super();
  }

  /** The native picker supplies the checkout; Renderer never supplies an executable or launch URI. */
  private async selectKawaikaraCheckout() {
    if (!this.developmentConnection) throw new Error("Kawaikara connection is unavailable.");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: t(normalizeLocale(app.getLocale()), "integration.dev.selectDirectory"),
    });
    if (result.canceled || !result.filePaths[0]) return this.developmentConnection.status();
    return this.developmentConnection.selectCheckout(result.filePaths[0]);
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
      await this.syncPreviewCookies();
      this.removeQueueListener = this.workerManager.onQueueChanged((items) => {
        this.windowManager.broadcast("queue:changed", items);
        this.companionManager.reportQueue(items);
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
    await this.cookieOperations;
    this.removeQueueListener?.();
    this.removeQueueListener = null;
    this.removeHandlers();
    this.initialized = false;
    return successReturnCode(
      IpcReturnType.Finalized,
      "IPC manager finalized",
    );
  }

  /** Transfers approved optional credentials to the private Worker, never to Renderer or durable settings. */
  private async prepareCompanion(requestId: string | undefined, sourceUrl: string): Promise<void> {
    if (!requestId) return;
    const cookies = await this.companionManager.requestCookies(requestId, sourceUrl);
    await this.workerManager.getClient().request('companion.prepare', { requestId, sourceUrl, cookies });
  }

  private registerHandlers(): void {
    ipcMain.handle("preview:resolve", async (event, videoId: unknown) => {
      const source = previewSource(videoId);
      if (!source) return { ok: false, error: "preview.failed" };
      await this.cookieOperations;
      const companionRequestId = this.windowManager.companionRequestFor(event.sender.id, source.url);
      await this.prepareCompanion(companionRequestId, source.url);
      return this.workerManager.getClient().request("preview.resolve", { videoId: source.key, companionRequestId }, YT_DLP_UPDATE_TIMEOUT_MS + 90_000);
    });
    let accessRequest: Promise<void> | null = null;
    ipcMain.handle("cookies:request-access", async (_event, options: BrowserCookieOptions) => {
      if (accessRequest) throw new Error("cookies.browserBusy");
      accessRequest = requestCookieKeychainAccess(options);
      try { await accessRequest; } finally { accessRequest = null; }
    });
    ipcMain.handle("cookies:open-permissions", async (_event, target: unknown) => {
      if (process.platform !== "darwin") throw new Error("cookies.settingsUnavailable");
      if (target === "files") {
        // Development has no kawai-downloader.app: reveal the actual Electron bundle
        // so the user can add it without guessing a node_modules/pnpm store path.
        const executable = await fs.realpath(process.execPath);
        const bundle = macAppBundleForExecutable(executable);
        if (bundle) shell.showItemInFolder(bundle);
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
      } else if (target === "keychain") {
        const candidates = ["/System/Library/CoreServices/Applications/Keychain Access.app", "/System/Applications/Utilities/Keychain Access.app"];
        for (const candidate of candidates) {
          if (await fs.stat(candidate).then(() => true, () => false)) {
            const error = await shell.openPath(candidate);
            if (error) throw new Error("cookies.settingsUnavailable");
            return;
          }
        }
        throw new Error("cookies.settingsUnavailable");
      } else throw new Error("cookies.settingsUnavailable");
    });
    ipcMain.handle("cookies:browser-status", (_event, options: BrowserCookieOptions) =>
      this.workerManager.getClient().request("cookies.browser-status", options));
    ipcMain.handle("cookies:profiles", (_event, options: BrowserCookieOptions) =>
      this.workerManager.getClient().request("cookies.profiles", options));
    ipcMain.handle("cookies:import-browser", (_event, options: BrowserCookieOptions) => {
      browserCookieSpec(options);
      return this.updateCookies(() => this.workerManager.getClient().request("cookies.import-browser", options,
        YT_DLP_UPDATE_TIMEOUT_MS + COOKIE_IMPORT_TIMEOUT_MS + 15_000));
    });
    ipcMain.handle("cookies:status", async () => { await this.cookieOperations; return this.cookieStatus; });
    ipcMain.handle("cookies:clear", (_event, site: unknown) => {
      const target = cookieSite(site);
      return this.updateCookies(() => this.workerManager.getClient().request("cookies.clear", { site: target }));
    });
    ipcMain.handle("app:yt-dlp-update-status", () => this.workerManager.getClient().request("dependency.update-status", {}));
    ipcMain.handle("app:yt-dlp-update-check", () => this.workerManager.getClient().request("dependency.update-check", {}));
    ipcMain.handle("cookies:import", async (_event, site: unknown) => {
      const target = cookieSite(site);
      const locale = this.preferenceManager.getPreferences().locale;
      const result = await dialog.showOpenDialog({
        title: t(locale, "cookies.import"),
        properties: ["openFile"],
        filters: [{ name: "cookies.txt", extensions: ["txt"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = await fs.open(result.filePaths[0], "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("cookies.invalid");
        // A bounded read also handles a file growing after stat().
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > 1024 * 1024) throw new Error("cookies.invalid");
        return await this.updateCookies(() => this.workerManager.getClient().request("cookies.import", { contents: buffer.subarray(0, length).toString("utf8"), site: target }));
      } finally {
        await file.close();
      }
    });
    ipcMain.handle("app:get-dependency-status", () =>
      this.workerManager.getClient().request("dependency.get", {}, YT_DLP_UPDATE_TIMEOUT_MS + 15_000),
    );
    ipcMain.handle("app:get-info", () => ({
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      isPackaged: app.isPackaged,
      runtimeAppPath: process.platform === "darwin" ? macAppBundleForExecutable(process.execPath) : null,
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

    ipcMain.handle("app:development-connection", async (event, operation: unknown, hostId: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame || !this.windowManager.ownsRenderer(event.sender.id))
        throw new Error("Untrusted connection sender.");
      if (!this.developmentConnection) return { development: false, state: "disconnected" };
      if (operation === "selectDirectory") return this.selectKawaikaraCheckout();
      if (operation === "installed") return this.developmentConnection.useInstalled();
      if (operation === "connect" && this.developmentConnection.status().requiresDirectory)
        return this.selectKawaikaraCheckout();
      if (operation === "automatic") {
        if (hostId !== "true" && hostId !== "false") throw new Error("Invalid automatic connection preference.");
        return this.developmentConnection.setAutomatic(hostId === "true");
      }
      if (operation === "status") return this.developmentConnection.status();
      if (operation === "disconnect") return this.developmentConnection.disconnect();
      if (operation !== "connect" || (hostId !== undefined && (typeof hostId !== "string" || !/^[a-f0-9-]{36}$/.test(hostId))))
        throw new Error("Invalid connection operation.");
      return this.developmentConnection.connect(hostId as string | undefined);
    });
    ipcMain.handle("app:open-kawaikara", async (event) => {
      if (event.senderFrame !== event.sender.mainFrame || !this.windowManager.ownsRenderer(event.sender.id))
        throw new Error("Untrusted connection sender.");
      if (!this.developmentConnection) return false;
      if (this.developmentConnection.status().requiresDirectory)
        return (await this.selectKawaikaraCheckout()).state === "connected";
      return this.developmentConnection.open();
    });

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
      async (event: IpcMainInvokeEvent, item: DownloadQueueItem) => {
        const bound = this.windowManager.bindCompanionRequest(event.sender.id, item);
        await this.prepareCompanion(bound.companionRequestId, bound.payload.url);
        return this.workerManager.getClient().request("queue.enqueue", { item: bound });
      },
    );
    ipcMain.handle(
      "queue:update",
      async (event: IpcMainInvokeEvent, item: DownloadQueueItem) => {
        const bound = this.windowManager.bindCompanionRequest(event.sender.id, item);
        await this.prepareCompanion(bound.companionRequestId, bound.payload.url);
        return this.workerManager.getClient().request("queue.update", { item: bound });
      },
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
      (event: IpcMainInvokeEvent, title: string, sourceKey?: string) =>
        this.windowManager.updateTabTitle(event.sender.id, title, sourceKey),
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

  private async syncPreviewCookies(): Promise<CookieStatus> {
    const client = this.workerManager.getClient();
    const status = await client.request("cookies.status", {});
    try {
      const contents = status.configured ? await client.request("cookies.preview", {}) : null;
      const previewCount = await applyPreviewCookies(session.fromPartition(PREVIEW_PARTITION), contents);
      this.cookieStatus = { ...status, previewCount, previewApplied: previewCount > 0, previewError: false };
    } catch {
      this.cookieStatus = { ...status, previewApplied: false, previewCount: 0, previewError: true };
    }
    return this.cookieStatus;
  }

  // Preview cookies are a disposable copy. A logged-out iframe may delete or
  // replace them; it must never overwrite the explicitly imported source jar.

  private updateCookies(operation: () => Promise<CookieStatus>): Promise<CookieStatus> {
    const result = this.cookieOperations.then(async () => {
      await operation();
      const status = await this.syncPreviewCookies();
      this.windowManager.broadcast("cookies:changed", status);
      return status;
    });
    this.cookieOperations = result.catch(() => {});
    return result;
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
