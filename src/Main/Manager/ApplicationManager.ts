import { app, dialog } from "electron";
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
import { UpdateManager } from "./UpdateManager";

export class ApplicationManager extends BaseManager<ApplicationReturnType> {
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

  registerLifecycle(): void {
    if (this.lifecycleRegistered) return;
    this.lifecycleRegistered = true;

    void app.whenReady().then(() => this.handleReady());
    app.on("window-all-closed", this.handleAllWindowsClosed);
    app.on("before-quit", this.handleBeforeQuit);
  }

  openExternalUrl(value: string): void {
    if (this.windowManager?.openExternalUrl(value)) return;
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

      this.windowManager = new WindowManager(rendererResult.data.url);
      this.ipcManager = new IPCManager(
        this.workerManager,
        this.windowManager,
        this.preferenceManager,
        this.updateManager,
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
        this.windowManager.openExternalUrl(value);
      }

      this.initialized = true;
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
    const results = await Promise.all([
      this.windowManager?.finalize(),
      this.ipcManager?.finalize(),
      this.rendererServerManager.finalize(),
      this.workerManager.finalize(),
      this.updateManager.finalize(),
      this.preferenceManager.finalize(),
    ]);
    this.windowManager = null;
    this.ipcManager = null;
    this.initialized = false;

    const failed = results.find((result) => result && !result.ok);
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
      title: "YT Section Downloader",
      type: "error",
    });
    this.allowQuit = true;
    app.quit();
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
