import { KawaikaraConnection } from "../KawaikaraConnection";
import path from "node:path";
import { DevelopmentConnection } from "../DevelopmentConnection";
import { readDevelopmentAppIcon } from "../DevelopmentAppIcon";
import { app, dialog, shell } from "electron";
import {
  failureReturnCode,
  getReturnCodeMessage,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { normalizeLocale } from "../../Shared/locale";
import { translate as t } from "../../Shared/nodeI18n";
import { BaseManager } from "./BaseManager";
import { IPCManager } from "./IPCManager";
import { PreferenceManager } from "./PreferenceManager";
import { RendererServerManager } from "./RendererServerManager";
import { ApplicationReturnType } from "./ReturnTypes";
import { WindowManager } from "./WindowManager";
import { WorkerManager } from "./WorkerManager";
import { CompanionManager } from "./CompanionManager";
import { UpdateManager } from "./UpdateManager";

export class ApplicationManager extends BaseManager<ApplicationReturnType> {
  private developmentConnection?: KawaikaraConnection;
  private allowQuit = false;
  private initialized = false;
  private ipcManager: IPCManager | null = null;
  private lifecycleRegistered = false;
  private readonly preferenceManager = new PreferenceManager();
  private readonly pendingExternalUrls: string[] = [];
  private readonly rendererServerManager = new RendererServerManager();
  private readonly updateManager = new UpdateManager();
  private windowManager: WindowManager | null = null;
  private readonly workerManager = new WorkerManager();
  private readonly companionManager = new CompanionManager();

  registerLifecycle(): void {
    if (this.lifecycleRegistered) return;
    this.lifecycleRegistered = true;

    void app.whenReady().then(() => this.handleReady());
    app.on("window-all-closed", this.handleAllWindowsClosed);
    app.on("before-quit", this.handleBeforeQuit);
  }

  openExternalUrl(value: string): void {
    if (this.windowManager && this.initialized) {
      void this.windowManager.openExternalUrl(value).catch(error => console.error("External request could not be opened:", error instanceof Error ? error.message : "Unknown error"));
      return;
    }
    this.pendingExternalUrls.push(value);
  }

  focusMainWindow(): void {
    this.windowManager?.focusMainWindow();
  }

  async initialize(): Promise<ReturnCode<ApplicationReturnType>> {
    if (this.initialized) {
      return successReturnCode(
        ApplicationReturnType.Initialized,
        "Application is already initialized",
      );
    }

    try {
      const preferenceResult = await this.preferenceManager.initialize();
      if (!preferenceResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.PreferenceInitializationFailed,
          "Application could not initialize preferences",
          getReturnCodeMessage(preferenceResult),
        );
      }

      const workerResult = await this.workerManager.initialize();
      if (!workerResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.WorkerInitializationFailed,
          "Application could not initialize the download Worker",
          getReturnCodeMessage(workerResult),
        );
      }

      const updateResult = await this.updateManager.initialize();
      if (!updateResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.UnexpectedInitializationFailed,
          "Application could not initialize update checks",
          getReturnCodeMessage(updateResult),
        );
      }

      const rendererResult = await this.rendererServerManager.initialize();
      if (!rendererResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.RendererServerInitializationFailed,
          "Application could not initialize the renderer server",
          getReturnCodeMessage(rendererResult),
        );
      }

      this.windowManager = new WindowManager(
        rendererResult.data.url,
        this.companionManager,
      );
      this.developmentConnection = new KawaikaraConnection(
        app.getPath("userData"), app.isPackaged,
        (file, directory) => new DevelopmentConnection(
          file, (url) => this.openExternalUrl(url), directory,
          () => readDevelopmentAppIcon(path.join(app.getAppPath(), "resources", "app-icon.png")),
        ),
        () => shell.openExternal("kawaikara://bridge/wake"),
      );
      this.ipcManager = new IPCManager(
        this.workerManager,
        this.windowManager,
        this.preferenceManager,
        this.updateManager,
        this.companionManager,
        this.developmentConnection,
      );
      const ipcResult = await this.ipcManager.initialize();
      if (!ipcResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.IpcInitializationFailed,
          "Application could not initialize IPC",
          getReturnCodeMessage(ipcResult),
        );
      }

      const windowResult = await this.windowManager.initialize();
      if (!windowResult.ok) {
        return failureReturnCode(
          ApplicationReturnType.WindowInitializationFailed,
          "Application could not initialize its window",
          getReturnCodeMessage(windowResult),
        );
      }

      if (this.preferenceManager.getPreferences().automaticUpdates) {
        void this.updateManager.checkForUpdates(app.getVersion());
      }

      for (const value of this.pendingExternalUrls.splice(0)) {
        void this.windowManager.openExternalUrl(value).catch(error => console.error("External request could not be opened:", error instanceof Error ? error.message : "Unknown error"));
      }

      this.initialized = true;
      await this.developmentConnection?.start(process.env.KAWAIKARA_EXTERNAL_APP_CONNECTION_DIRECTORY);
      return successReturnCode(
        ApplicationReturnType.Initialized,
        "Application initialized",
      );
    } catch (error) {
      return failureReturnCode(
        ApplicationReturnType.UnexpectedInitializationFailed,
        "Unexpected application initialization failure",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<ApplicationReturnType>> {
    await this.developmentConnection?.dispose();
    // Persist any last preview-cookie refresh while the Worker is still alive.
    const ipcResult = await this.ipcManager?.finalize();
    const results = await Promise.all([
      this.windowManager?.finalize(),
      this.rendererServerManager.finalize(),
      this.workerManager.finalize(),
      this.updateManager.finalize(),
      this.preferenceManager.finalize(),
    ]);
    this.windowManager = null;
    this.ipcManager = null;
    this.initialized = false;

    const failed = [ipcResult, ...results].find((result) => result && !result.ok);
    if (failed && !failed.ok) {
      return failureReturnCode(
        ApplicationReturnType.FinalizationFailed,
        "Application finalization failed",
        getReturnCodeMessage(failed),
      );
    }
    return successReturnCode(
      ApplicationReturnType.Finalized,
      "Application finalized",
    );
  }

  private readonly handleAllWindowsClosed = (): void => {
    app.quit();
  };

  private readonly handleBeforeQuit = (event: Electron.Event): void => {
    if (this.allowQuit) return;
    event.preventDefault();
    this.allowQuit = true;
    void this.finalize().finally(() => app.quit());
  };

  private async handleReady(): Promise<void> {
    const result = await this.initialize();
    if (result.ok) return;

    await this.finalize();
    const locale = normalizeLocale(app.getLocale());
    const message =
      result.code === ApplicationReturnType.WorkerInitializationFailed
        ? t(locale, "main.error.workerStart")
        : result.code === ApplicationReturnType.RendererServerInitializationFailed
          ? t(locale, "main.error.rendererUrl")
          : t(locale, "main.error.appStart");
    await dialog.showMessageBox({
      detail: getReturnCodeMessage(result),
      message,
      title: "kawai-downloader",
      type: "error",
    });
    this.allowQuit = true;
    app.quit();
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
