const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.env.UI_HARNESS_PORT || 4173);
const rendererRoot = path.resolve(__dirname, "../build/renderer");
const mockVideoTitle = process.env.UI_HARNESS_VIDEO_TITLE || "Mock video";
const mockDownloadError = process.env.UI_HARNESS_DOWNLOAD_ERROR || "";
const mockDuration = Number(process.env.UI_HARNESS_DURATION || 600);
let queueState = null;
let lastRequest = null;

const mockBridge = `(() => {
  let queueChangedHandler = () => {};
  let preferencesChangedHandler = () => {};
  let tabsChangedHandler = () => {};
  let queueItems = [];
  let queueLoaded = false;
  let activeTabId = "tab-1";
  let tabSequence = 1;
  let tabs = [{ id: "tab-1", title: ${JSON.stringify(mockVideoTitle)}, active: true }];
  let preferences = {
    automaticUpdates: true,
    defaultDownloadQuality: "best",
    defaultEncodingPreset: "youtube-copy",
    defaultOutputDir: "C:\\Downloads",
    defaultSpeedLimit: "",
    frameRate: 30,
    locale: "en",
    seekLargeSeconds: 10,
    seekSmallSeconds: 1
  };
  const downloadError = ${JSON.stringify(mockDownloadError)};

  function getTabs() {
    return {
      activeTabId,
      tabs: tabs.map((tab) => ({ ...tab, active: tab.id === activeTabId }))
    };
  }

  function emitTabs() {
    const snapshot = getTabs();
    tabsChangedHandler(structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async function loadQueue() {
    if (queueLoaded) return;
    queueLoaded = true;
    const response = await fetch("/queue-state");
    const text = await response.text();
    if (!text) return;
    const parsed = JSON.parse(text);
    queueItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
  }

  async function saveQueue() {
    await fetch("/queue-state", {
      method: "POST",
      body: JSON.stringify({ version: 2, items: queueItems })
    });
    queueChangedHandler(structuredClone(queueItems));
  }

  async function finishQueueItem(itemId) {
    const item = queueItems.find((candidate) => candidate.id === itemId);
    if (!item || item.status !== "queued") return;
    item.status = "running";
    item.message = "Starting";
    await saveQueue();
    await fetch("/last-request", {
      method: "POST",
      body: JSON.stringify(item.payload)
    });
    if (downloadError) {
      item.status = "error";
      item.error = downloadError;
      item.message = downloadError;
      item.log = ["[error] " + downloadError];
      await saveQueue();
      return;
    }

    const skipped = new Set(item.payload.skipSegmentKeys || []);
    const completedSegments = item.payload.segments
      .filter((segment) => !skipped.has(segment.key))
      .map((segment) => ({
        key: segment.key,
        outputPath: "C:\\\\Downloads\\\\mock-" + segment.key.replace(/[^0-9.-]/g, "") + ".mp4"
      }));
    item.status = "done";
    item.progress = 1;
    item.completedSegmentKeys = item.payload.segments.map((segment) => segment.key);
    item.outputPaths = completedSegments.map((segment) => segment.outputPath);
    item.outputPath = item.outputPaths[0] || null;
    item.error = null;
    item.message = "Complete";
    item.log = ["[done] Complete"];
    await saveQueue();
  }

  class MockPlayer {
    constructor(_elementId, options) {
      this.options = options;
      this.videoId = options.videoId;
      this.currentTime = 0;
      this.duration = ${JSON.stringify(mockDuration)};
      this.state = 2;
      this.startedAt = 0;
      setTimeout(() => options.events.onReady(), 0);
    }
    loadVideoById(videoId) {
      this.videoId = videoId;
      this.currentTime = 0;
      this.playVideo();
      setTimeout(() => this.options.events.onStateChange(), 0);
    }
    cueVideoById(videoId) {
      this.videoId = videoId;
      this.currentTime = 0;
      this.state = 2;
      this.startedAt = 0;
      setTimeout(() => this.options.events.onStateChange(), 0);
    }
    getCurrentTime() {
      if (this.state !== 1) return this.currentTime;
      return Math.min(
        this.duration,
        this.currentTime + (Date.now() - this.startedAt) / 1000
      );
    }
    getDuration() { return this.duration; }
    getPlayerState() { return this.state; }
    getVideoData() {
      return { title: ${JSON.stringify(mockVideoTitle)}, video_id: this.videoId };
    }
    pauseVideo() {
      this.currentTime = this.getCurrentTime();
      this.state = 2;
      this.startedAt = 0;
      this.options.events.onStateChange();
    }
    playVideo() {
      if (this.state !== 1) {
        this.startedAt = Date.now();
        this.state = 1;
        this.options.events.onStateChange();
      }
    }
    seekTo(seconds) {
      this.currentTime = Math.max(0, Math.min(this.duration, Number(seconds)));
      if (this.state === 1) this.startedAt = Date.now();
    }
  }

  window.YT = { Player: MockPlayer, PlayerState: { PLAYING: 1 } };
  window.ytClipper = {
    getDependencyStatus: async () => ({
      ytDlp: { available: true, command: "mock", version: "mock" },
      ffmpeg: { available: true, command: "mock", version: "mock" }
    }),
    selectOutputDir: async () => "C:\\\\Downloads",
    enqueueDownload: async (item) => {
      await loadQueue();
      if (!queueItems.some((candidate) => candidate.id === item.id)) {
        queueItems.push(structuredClone(item));
      }
      await saveQueue();
      setTimeout(() => { void finishQueueItem(item.id); }, 0);
      return structuredClone(queueItems);
    },
    updateQueuedDownload: async (item) => {
      await loadQueue();
      const index = queueItems.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) queueItems[index] = structuredClone(item);
      else queueItems.push(structuredClone(item));
      await saveQueue();
      setTimeout(() => { void finishQueueItem(item.id); }, 0);
      return structuredClone(queueItems);
    },
    getDownloadQueue: async () => {
      await loadQueue();
      return structuredClone(queueItems);
    },
    removeQueuedDownload: async (itemId) => {
      await loadQueue();
      queueItems = queueItems.filter((item) => item.id !== itemId || item.status === "running");
      await saveQueue();
      return structuredClone(queueItems);
    },
    removeQueuedDownloads: async (itemIds) => {
      await loadQueue();
      const ids = new Set(itemIds);
      queueItems = queueItems.filter((item) => !ids.has(item.id));
      await saveQueue();
      return structuredClone(queueItems);
    },
    clearDownloadQueue: async () => {
      await loadQueue();
      queueItems = [];
      await saveQueue();
      return [];
    },
    pauseQueuedDownload: async (itemId) => {
      await loadQueue();
      const item = queueItems.find((candidate) => candidate.id === itemId);
      if (item && (item.status === "queued" || item.status === "running")) {
        item.status = "paused";
        item.message = "Paused";
      }
      await saveQueue();
      return structuredClone(queueItems);
    },
    resumeQueuedDownload: async (itemId) => {
      await loadQueue();
      const item = queueItems.find((candidate) => candidate.id === itemId);
      if (item && (item.status === "paused" || item.status === "error")) {
        item.status = "queued";
        item.message = "Waiting to resume";
        setTimeout(() => { void finishQueueItem(item.id); }, 0);
      }
      await saveQueue();
      return structuredClone(queueItems);
    },
    cancelDownload: async () => ({ canceled: true }),
    openOutput: async () => true,
    getBrowserTabs: async () => getTabs(),
    createBrowserTab: async () => {
      tabSequence += 1;
      activeTabId = "tab-" + tabSequence;
      tabs.push({ id: activeTabId, title: "YouTube " + tabSequence, active: true });
      return emitTabs();
    },
    activateBrowserTab: async (tabId) => {
      if (tabs.some((tab) => tab.id === tabId)) activeTabId = tabId;
      return emitTabs();
    },
    closeBrowserTab: async (tabId) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index >= 0) tabs.splice(index, 1);
      if (tabs.length === 0) {
        tabSequence += 1;
        tabs.push({ id: "tab-" + tabSequence, title: "YouTube " + tabSequence, active: true });
      }
      if (!tabs.some((tab) => tab.id === activeTabId)) {
        activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
      }
      return emitTabs();
    },
    updateBrowserTabTitle: async (title) => {
      const tab = tabs.find((candidate) => candidate.id === activeTabId);
      if (tab && title.trim()) tab.title = title.trim();
      return emitTabs();
    },
    openQueueWindow: async () => {
      window.__mockQueueWindowOpened = true;
      document.body.dataset.mockQueueOpened = "true";
      return true;
    },
    getAppInfo: async () => ({
      arch: "x64",
      name: "YT Section Downloader",
      platform: "test",
      version: "0.1.0"
    }),
    checkForUpdates: async () => ({
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      message: "The app is current",
      releaseUrl: "https://github.com/fabyday/yt-downloader/releases/latest",
      status: "current"
    }),
    openExternalUrl: async (url) => {
      window.__mockExternalUrl = url;
      return true;
    },
    getPreferences: async () => structuredClone(preferences),
    updatePreferences: async (updates) => {
      preferences = { ...preferences, ...updates };
      preferencesChangedHandler(structuredClone(preferences));
      return structuredClone(preferences);
    },
    onBrowserTabsChanged: (handler) => {
      tabsChangedHandler = handler;
      return () => { tabsChangedHandler = () => {}; };
    },
    onDownloadQueueChanged: (handler) => {
      queueChangedHandler = handler;
      return () => { queueChangedHandler = () => {}; };
    },
    onPreferencesChanged: (handler) => {
      preferencesChangedHandler = handler;
      return () => { preferencesChangedHandler = () => {}; };
    }
  };
})();`;

const server = http.createServer((request, response) => {
  if (request.url === "/mock-bridge.js") {
    response.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(mockBridge);
    return;
  }

  if (request.url === "/last-request") {
    if (request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        lastRequest = body;
        response.writeHead(204);
        response.end();
      });
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(lastRequest || "");
    return;
  }

  if (request.url === "/queue-state") {
    if (request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        queueState = body;
        response.writeHead(204);
        response.end();
      });
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(queueState || "");
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(rendererRoot, `.${pathname}`);
  if (!filePath.startsWith(rendererRoot) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  let content = fs.readFileSync(filePath);
  if (pathname === "/index.html") {
    content = Buffer.from(
      content.toString("utf8").replace(
        '<script src="./app.js"></script>',
        '<script src="./mock-bridge.js"></script><script src="./app.js"></script>'
      )
    );
  }

  const extension = path.extname(filePath);
  const contentType = extension === ".css"
    ? "text/css; charset=utf-8"
    : extension === ".js"
      ? "application/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(content);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UI harness listening on http://127.0.0.1:${port}`);
});
