import {
  app,
  BrowserWindow,
  Menu,
  screen,
  WebContentsView,
  type WebContents,
} from "electron";
import * as path from "node:path";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { parseVideoSource, previewSource } from "../../Shared/VideoSource";
import type { DownloadQueueItem } from "../../Shared/types";
import type { BrowserTabSnapshot } from "../../Shared/types";
import { parseDownloaderDeepLink } from "../ExternalProtocol";
import {
  getWindowChromeOptions,
  installMacWindowShortcuts,
  SHELL_CHROME_HEIGHT,
} from "../WindowChrome";
import { BaseManager } from "./BaseManager";
import { CompanionManager } from "./CompanionManager";
import { PREVIEW_PARTITION } from "../PreviewCookies";
import { WindowReturnType } from "./ReturnTypes";

interface ManagedTab {
  id: string;
  title: string;
  sourceKey?: string;
  companionRequestId?: string;
  resetting?: boolean;
  view: WebContentsView;
}

export class WindowManager extends BaseManager<WindowReturnType> {
  private activeTabId: string | null = null;
  private initialized = false;
  private mainWindow: BrowserWindow | null = null;
  private queueWindow: BrowserWindow | null = null;
  private readonly tabs = new Map<string, ManagedTab>();
  private tabSequence = 0;

  constructor(
    private readonly rendererUrl: string,
    private readonly companionManager: CompanionManager,
  ) {
    super();
  }

  async initialize(): Promise<ReturnCode<WindowReturnType>> {
    if (this.initialized) {
      return successReturnCode(
        WindowReturnType.Initialized,
        "Window manager is already initialized",
      );
    }

    try {
      Menu.setApplicationMenu(null);
      this.createMainWindow();
      this.createTab();
      this.initialized = true;
      return successReturnCode(
        WindowReturnType.Initialized,
        "Window manager initialized",
      );
    } catch (error) {
      return failureReturnCode(
        WindowReturnType.InitializationFailed,
        "Window manager initialization failed",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<WindowReturnType>> {
    try {
      for (const tab of this.tabs.values()) {
        if (!tab.view.webContents.isDestroyed()) {
          tab.view.webContents.close();
        }
      }
      this.tabs.clear();
      this.activeTabId = null;

      if (this.queueWindow && !this.queueWindow.isDestroyed()) {
        this.queueWindow.destroy();
      }
      this.queueWindow = null;

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.destroy();
      }
      this.mainWindow = null;
      this.initialized = false;
      return successReturnCode(
        WindowReturnType.Finalized,
        "Window manager finalized",
      );
    } catch (error) {
      return failureReturnCode(
        WindowReturnType.FinalizationFailed,
        "Window manager finalization failed",
        getErrorMessage(error),
      );
    }
  }

  getTabSnapshot(): BrowserTabSnapshot {
    return {
      activeTabId: this.activeTabId,
      tabs: [...this.tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title,
        active: tab.id === this.activeTabId,
      })),
    };
  }

  createTab(sourceUrl?: string, companionRequestId?: string): BrowserTabSnapshot {
    const mainWindow = this.requireMainWindow();
    this.tabSequence += 1;
    const id = `tab-${this.tabSequence}`;
    const view = new WebContentsView({
      webPreferences: this.createWebPreferences(),
    });
    const tab: ManagedTab = {
      id,
      title: `Video ${this.tabSequence}`,
      sourceKey: sourceUrl ? parseVideoSource(sourceUrl)?.key : undefined,
      companionRequestId,
      view,
    };

    view.setBackgroundColor("#111317");
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    installMacWindowShortcuts(
      view.webContents,
      () => mainWindow.close(),
      () => app.quit(),
    );
    view.webContents.on("destroyed", () => {
      if (this.tabs.get(id)?.view !== view) return;
      this.tabs.delete(id);
      if (this.activeTabId === id) {
        this.activeTabId = this.tabs.keys().next().value ?? null;
      }
      this.ensureAtLeastOneTab();
      this.layoutTabViews();
      this.emitTabsChanged();
    });

    this.tabs.set(id, tab);
    mainWindow.contentView.addChildView(view);
    void view.webContents.loadURL(
      this.createRendererUrl("editor", {
        tabId: id,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(companionRequestId ? { companionRequestId } : {}),
      }),
    );
    return this.activateTab(id);
  }

  openExternalUrl(value: string): boolean {
    const request = parseDownloaderDeepLink(value);
    if (!request || !this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }
    this.companionManager.acceptDeepLink(request);
    const key = parseVideoSource(request.sourceUrl)?.key;
    const existing = key ? [...this.tabs.values()].find(tab => tab.sourceKey === key && !tab.view.webContents.isDestroyed()) : undefined;
    if (existing) {
      existing.companionRequestId = request.companion?.requestId;
      this.activateTab(existing.id);
    } else {
      this.createTab(request.sourceUrl, request.companion?.requestId);
    }
    this.focusMainWindow();
    return true;
  }

  focusMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    active?.view.webContents.focus();
  }

  activateTab(tabId: string): BrowserTabSnapshot {
    const nextTab = this.tabs.get(tabId);
    if (!nextTab) return this.getTabSnapshot();

    this.activeTabId = tabId;
    for (const tab of this.tabs.values()) {
      tab.view.setVisible(tab.id === tabId);
    }

    const mainWindow = this.requireMainWindow();
    mainWindow.contentView.addChildView(nextTab.view);
    this.layoutTabViews();
    nextTab.view.webContents.focus();
    this.emitTabsChanged();
    return this.getTabSnapshot();
  }

  async closeTab(tabId: string): Promise<BrowserTabSnapshot> {
    const tabOrder = [...this.tabs.keys()];
    const closingIndex = tabOrder.indexOf(tabId);
    const tab = this.tabs.get(tabId);
    if (!tab || closingIndex < 0) return this.getTabSnapshot();

    if (this.tabs.size === 1) {
      if (tab.resetting || tab.view.webContents.isDestroyed()) return this.getTabSnapshot();
      tab.resetting = true;
      try {
        // Include typed but not yet loaded URLs. Do not reload an untouched editor.
        const hasInput = await tab.view.webContents.executeJavaScript(
          `Boolean(document.querySelector('#urlInput')?.value?.trim())`,
        );
        if (this.tabs.get(tabId) !== tab) return this.getTabSnapshot();
        if (!tab.sourceKey && !hasInput) return this.getTabSnapshot();
        await tab.view.webContents.loadURL(this.createRendererUrl("editor", { tabId }));
        tab.sourceKey = undefined;
        tab.companionRequestId = undefined;
        tab.title = "Video 1";
        this.emitTabsChanged();
        return this.getTabSnapshot();
      } finally {
        tab.resetting = false;
      }
    }

    const wasActive = this.activeTabId === tabId;
    this.tabs.delete(tabId);
    this.requireMainWindow().contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }

    if (this.tabs.size === 0) {
      this.activeTabId = null;
      return this.createTab();
    }

    if (wasActive) {
      const nextId =
        tabOrder[Math.min(closingIndex, tabOrder.length - 2)] ??
        this.tabs.keys().next().value;
      if (nextId) return this.activateTab(nextId);
    }

    this.emitTabsChanged();
    return this.getTabSnapshot();
  }

  updateTabTitle(webContentsId: number, rawTitle: string, sourceKey?: string): BrowserTabSnapshot {
    const tab = [...this.tabs.values()].find(
      (candidate) => candidate.view.webContents.id === webContentsId,
    );
    if (tab && sourceKey !== undefined) {
      const key = previewSource(sourceKey)?.key;
      if (key && key !== tab.sourceKey) {
        tab.sourceKey = key;
        tab.companionRequestId = undefined;
      }
    }
    const title = rawTitle.trim().replace(/\s+/g, " ").slice(0, 80);
    if (tab && title && tab.title !== title) {
      tab.title = title;
      this.emitTabsChanged();
    }
    return this.getTabSnapshot();
  }

  /** Allows connection settings IPC only from a known local application Renderer. */
  ownsRenderer(webContentsId: number): boolean {
    const targets = [this.mainWindow?.webContents, this.queueWindow?.webContents,
      ...[...this.tabs.values()].map(tab => tab.view.webContents)];
    return targets.some(contents => {
      if (!contents || contents.isDestroyed() || contents.id !== webContentsId) return false;
      try { return new URL(contents.getURL()).origin === new URL(this.rendererUrl).origin; }
      catch { return false; }
    });
  }

  /** Returns a request only when the sender's tab still owns the original source. */
  companionRequestFor(webContentsId: number, sourceUrl: string): string | undefined {
    const tab = [...this.tabs.values()].find(candidate => candidate.view.webContents.id === webContentsId);
    return tab && parseVideoSource(sourceUrl)?.key === tab.sourceKey ? tab.companionRequestId : undefined;
  }

  bindCompanionRequest(webContentsId: number, item: DownloadQueueItem): DownloadQueueItem {
    const tab = [...this.tabs.values()].find(candidate => candidate.view.webContents.id === webContentsId);
    if (!tab) return item; // Queue-window edits retain their original request.
    const { companionRequestId: _previous, ...rest } = item;
    const requestId = parseVideoSource(item.payload.url)?.key === tab.sourceKey ? tab.companionRequestId : undefined;
    return { ...rest, ...(requestId ? { companionRequestId: requestId } : {}) };
  }

  openQueueWindow(): void {
    if (this.queueWindow && !this.queueWindow.isDestroyed()) {
      if (this.queueWindow.isMinimized()) this.queueWindow.restore();
      this.queueWindow.show();
      this.queueWindow.focus();
      return;
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(1180, display.workAreaSize.width);
    const height = Math.min(780, display.workAreaSize.height);
    const queueWindow = new BrowserWindow({
      ...getWindowChromeOptions(),
      backgroundColor: "#111317",
      center: true,
      height,
      minHeight: Math.min(560, height),
      minWidth: Math.min(860, width),
      show: false,
      title: "Download Queue",
      webPreferences: this.createWebPreferences(),
      width,
    });
    this.queueWindow = queueWindow;
    queueWindow.setMenu(null);
    installMacWindowShortcuts(
      queueWindow.webContents,
      () => queueWindow.close(),
      () => app.quit(),
    );
    queueWindow.once("ready-to-show", () => queueWindow.show());
    queueWindow.on("closed", () => {
      if (this.queueWindow === queueWindow) this.queueWindow = null;
    });
    void queueWindow.loadURL(this.createRendererUrl("queue"));
  }

  broadcast(channel: string, payload: unknown): void {
    const targets: WebContents[] = [];
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      targets.push(this.mainWindow.webContents);
    }
    if (this.queueWindow && !this.queueWindow.isDestroyed()) {
      targets.push(this.queueWindow.webContents);
    }
    for (const tab of this.tabs.values()) {
      targets.push(tab.view.webContents);
    }

    for (const target of targets) {
      if (!target.isDestroyed()) target.send(channel, payload);
    }
  }

  private createMainWindow(): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(1440, workArea.width);
    const height = Math.min(900, workArea.height);
    const mainWindow = new BrowserWindow({
      ...getWindowChromeOptions(),
      backgroundColor: "#111317",
      center: true,
      height,
      minHeight: Math.min(820, height),
      minWidth: Math.min(1100, width),
      title: "kawai-downloader",
      webPreferences: this.createWebPreferences(),
      width,
    });
    this.mainWindow = mainWindow;
    mainWindow.setMenu(null);
    installMacWindowShortcuts(
      mainWindow.webContents,
      () => mainWindow.close(),
      () => app.quit(),
    );
    const updateLayout = () => {
      this.layoutTabViews();
      // Native frame insets can settle after the Windows maximize/resize event.
      setImmediate(() => this.layoutTabViews());
    };
    mainWindow.on("resize", updateLayout);
    mainWindow.on("maximize", updateLayout);
    mainWindow.on("unmaximize", updateLayout);
    mainWindow.on("enter-full-screen", updateLayout);
    mainWindow.on("leave-full-screen", updateLayout);
    mainWindow.on("closed", () => this.handleMainWindowClosed(mainWindow));
    mainWindow.webContents.on("did-finish-load", () => this.emitTabsChanged());
    void mainWindow.loadURL(this.createRendererUrl("shell"));
    return mainWindow;
  }

  private createWebPreferences(): Electron.WebPreferences {
    return {
      partition: PREVIEW_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: false,
    };
  }

  private createRendererUrl(
    view: "shell" | "editor" | "queue",
    values: Record<string, string> = {},
  ): string {
    const url = new URL(this.rendererUrl);
    url.searchParams.set("view", view);
    url.searchParams.set("platform", process.platform);
    for (const [key, value] of Object.entries(values)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private ensureAtLeastOneTab(): void {
    if (this.tabs.size === 0 && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.createTab();
    }
  }

  private handleMainWindowClosed(closedWindow: BrowserWindow): void {
    if (this.mainWindow !== closedWindow) return;
    this.mainWindow = null;
    this.activeTabId = null;
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    if (this.queueWindow && !this.queueWindow.isDestroyed()) {
      this.queueWindow.destroy();
    }
    this.queueWindow = null;
  }

  private layoutTabViews(): void {
    const mainWindow = this.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    const bounds = {
      x: 0,
      y: SHELL_CHROME_HEIGHT,
      width: Math.max(1, width),
      height: Math.max(1, height - SHELL_CHROME_HEIGHT),
    };
    for (const tab of this.tabs.values()) {
      tab.view.setBounds(bounds);
    }
  }

  private emitTabsChanged(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send("tabs:changed", this.getTabSnapshot());
  }

  private requireMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error("Main window is not available");
    }
    return this.mainWindow;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
