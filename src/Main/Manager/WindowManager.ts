import {
  BrowserWindow,
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
import type { BrowserTabSnapshot } from "../../Shared/types";
import { getSourceUrlFromDeepLink } from "../ExternalProtocol";
import { BaseManager } from "./BaseManager";
import { WindowReturnType } from "./ReturnTypes";

const TAB_STRIP_HEIGHT = 48;
const MAX_TABS = 12;

interface ManagedTab {
  id: string;
  title: string;
  view: WebContentsView;
}

export class WindowManager extends BaseManager<WindowReturnType> {
  private activeTabId: string | null = null;
  private initialized = false;
  private mainWindow: BrowserWindow | null = null;
  private queueWindow: BrowserWindow | null = null;
  private readonly tabs = new Map<string, ManagedTab>();
  private tabSequence = 0;

  constructor(private readonly rendererUrl: string) {
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

  createTab(sourceUrl?: string): BrowserTabSnapshot {
    if (this.tabs.size >= MAX_TABS) {
      return this.getTabSnapshot();
    }

    const mainWindow = this.requireMainWindow();
    this.tabSequence += 1;
    const id = `tab-${this.tabSequence}`;
    const view = new WebContentsView({
      webPreferences: this.createWebPreferences(),
    });
    const tab: ManagedTab = {
      id,
      title: `YouTube ${this.tabSequence}`,
      view,
    };

    view.setBackgroundColor("#111317");
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
      }),
    );
    return this.activateTab(id);
  }

  openExternalUrl(value: string): boolean {
    const sourceUrl = getSourceUrlFromDeepLink(value);
    if (!sourceUrl || !this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }
    this.focusMainWindow();
    this.createTab(sourceUrl);
    return true;
  }

  focusMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
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

  closeTab(tabId: string): BrowserTabSnapshot {
    const tabOrder = [...this.tabs.keys()];
    const closingIndex = tabOrder.indexOf(tabId);
    const tab = this.tabs.get(tabId);
    if (!tab || closingIndex < 0) return this.getTabSnapshot();

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

  updateTabTitle(webContentsId: number, rawTitle: string): BrowserTabSnapshot {
    const tab = [...this.tabs.values()].find(
      (candidate) => candidate.view.webContents.id === webContentsId,
    );
    const title = rawTitle.trim().replace(/\s+/g, " ").slice(0, 80);
    if (tab && title && tab.title !== title) {
      tab.title = title;
      this.emitTabsChanged();
    }
    return this.getTabSnapshot();
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
      backgroundColor: "#111317",
      center: true,
      height,
      minHeight: Math.min(720, height),
      minWidth: Math.min(1100, width),
      title: "YT Section Downloader",
      webPreferences: this.createWebPreferences(),
      width,
    });
    this.mainWindow = mainWindow;
    mainWindow.on("resize", () => this.layoutTabViews());
    mainWindow.on("closed", () => this.handleMainWindowClosed(mainWindow));
    mainWindow.webContents.on("did-finish-load", () => this.emitTabsChanged());
    void mainWindow.loadURL(this.createRendererUrl("shell"));
    return mainWindow;
  }

  private createWebPreferences(): Electron.WebPreferences {
    return {
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
      y: TAB_STRIP_HEIGHT,
      width: Math.max(1, width),
      height: Math.max(1, height - TAB_STRIP_HEIGHT),
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
