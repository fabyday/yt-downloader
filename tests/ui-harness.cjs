const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.env.UI_HARNESS_PORT || 4173);
const rendererRoot = path.resolve(__dirname, "../build/renderer");
const mockVideoTitle = process.env.UI_HARNESS_VIDEO_TITLE || "Mock video";
const mockDownloadError = process.env.UI_HARNESS_DOWNLOAD_ERROR || "";
const mockDuration = Number(process.env.UI_HARNESS_DURATION || 600);
const mockLocale = ['en', 'ko', 'ja'].includes(process.env.UI_HARNESS_LOCALE) ? process.env.UI_HARNESS_LOCALE : 'en';
let queueState = null;
let lastRequest = null;

const mockBridge = `(() => {
  let queueChangedHandler = () => {};
  let preferencesChangedHandler = () => {};
  let tabsChangedHandler = () => {};
  let queueItems = [];
  let queueLoaded = false;
  let cookieStatus = { configured: false, count: 0 };
  let activeTabId = "tab-1";
  let tabSequence = 1;
  let tabs = [{ id: "tab-1", title: ${JSON.stringify(mockVideoTitle)}, active: true }];
  let preferences = {
    hardwareAcceleration: true,
    automaticUpdates: true,
    defaultDownloadQuality: "best",
    defaultEncodingPreset: "youtube-copy",
    defaultOutputDir: "C:\\Downloads",
    defaultSpeedLimit: "",
    frameRate: 30,
    locale: ${JSON.stringify(mockLocale)},
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
    destroy() { window.playerRecreated = (window.playerRecreated || 0) + 1; }
    constructor(_elementId, options) {
      window.mockPlayer = this;
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

  // Simulate media timing only; the production NativePreview and DOM/layout still run.
  // Real-media diagnostics opt out and use the supplied local video fixture.
  window.YT = { Player: MockPlayer, PlayerState: { PLAYING: 1 } };
  if (!${Boolean(process.env.UI_HARNESS_MEDIA_FIXTURE || process.env.UI_HARNESS_REAL_MEDIA)}) {
    const proto = HTMLMediaElement.prototype;
    const playerFor = element => element.__player;
    Object.defineProperty(proto, 'src', { configurable: true, get() { return this.__src || ''; }, set(value) {
      this.__src = value;
      const element = this;
      clearInterval(this.__frameTimer);
      this.__frameTimer=setInterval(()=>{if(!element.paused && !element.seeking) element.__frame?.(performance.now(),{mediaTime:element.currentTime});},16);
      this.__player = new MockPlayer('', { videoId: window.__previewVideoId,
        events: { onReady() { element.dispatchEvent(new Event('loadeddata')); element.__frame?.(); },
          onStateChange() { element.dispatchEvent(new Event(element.__player.state === 1 ? 'play' : 'pause')); } } });
    } });
    for (const [key, get] of Object.entries({
      duration() { return playerFor(this)?.getDuration() || 0; },
      paused() { return playerFor(this)?.state !== 1; },
      ended() { return false; }, readyState() { return 2; }, seeking() { return !!this.__seeking; },
    })) Object.defineProperty(proto, key, { configurable: true, get });
    Object.defineProperty(proto, 'currentTime', { configurable: true,
      get() { return playerFor(this)?.getCurrentTime() || 0; },
      set(value) {
        clearTimeout(this.__seekTimer); this.__seeking = true; this.dispatchEvent(new Event('seeking'));
        const finish = () => { playerFor(this)?.seekTo(value); this.__seeking = false; this.__frame?.(performance.now(),{mediaTime:this.currentTime}); this.dispatchEvent(new Event('seeked')); };
        if (window.mockSeekDelayMs) this.__seekTimer = setTimeout(finish, window.mockSeekDelayMs); else finish();
      }
    });
    proto.play = function() { playerFor(this)?.playVideo(); this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
    proto.pause = function() { playerFor(this)?.pauseVideo(); };
    proto.load = function() { clearTimeout(this.__seekTimer); clearInterval(this.__frameTimer); };
    for (const [key, value] of Object.entries({ videoWidth: 640, videoHeight: 360 })) {
      Object.defineProperty(HTMLVideoElement.prototype, key, { configurable: true, get: () => value });
    }
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) { this.__frame = callback; return 1; };
  }
  window.ytClipper = {
    getBrowserProfiles: async ({browser}) => ({supported:!['safari','opera'].includes(browser),profiles:browser==='chrome'?[{value:'Default',label:'Personal (Default)'},{value:'Profile 1',label:'Work (Profile 1)'}]:[]}),
    resolvePreview: async videoId => {
      window.__previewVideoId = videoId;
      return window.mockPreviewResult || {ok:true,videoId,title:${JSON.stringify(mockVideoTitle)},duration:${JSON.stringify(mockDuration)},
        url: ${Boolean(process.env.UI_HARNESS_MEDIA_FIXTURE)} ? location.origin + '/preview-fixture.mp4' : 'https://media.googlevideo.com/fixture'};
    },
    getCookieStatus: async () => ({ ...cookieStatus }),
    openCookiePermissionSettings: async () => {},
    requestCookieAccess: async () => {},
    onCookiesChanged: handler => {
      window.cookieListeners ||= new Set();
      window.cookieListeners.add(handler);
      return () => window.cookieListeners.delete(handler);
    },
    getBrowserCookieStatus: async () => ({ running: false }),
    importCookies: async () => (cookieStatus = { configured: true, count: 3 }),
    importBrowserCookies: async () => (cookieStatus = { configured: true, count: 3 }),
    clearCookies: async () => (cookieStatus = { configured: false, count: 0 }),
    getYtDlpUpdateStatus: async () => ({ status: "current", version: "2026.10.01" }),
    checkYtDlpUpdate: async () => { window.__ytDlpUpdateChecks = (window.__ytDlpUpdateChecks || 0) + 1; return { status: "current", version: "2026.10.01" }; },
    getDependencyStatus: async () => ({
      ytDlp: { available: true, command: "mock", version: "2026.08.19" },
      ffmpeg: { available: true, command: "mock", version: "ffmpeg version 7.1-tessus https://evermeet.cx/ffmpeg/ Copyright (c) 2000-2024" }
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
    developmentConnection: async () => ({ development: false, state: "disconnected" }),
    openKawaikara: async () => {
      window.__mockKawaikaraOpened = true;
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
    response.end(mockBridge + (server.previewResult ? `window.mockPreviewResult = ${JSON.stringify(server.previewResult)};` : ""));
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
  if (requestUrl.pathname === '/preview-fixture.mp4' && process.env.UI_HARNESS_MEDIA_FIXTURE) {
    response.writeHead(200, {'Content-Type':'video/mp4'});
    fs.createReadStream(process.env.UI_HARNESS_MEDIA_FIXTURE).pipe(response);
    return;
  }
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(rendererRoot, `.${pathname}`);
  if (!filePath.startsWith(rendererRoot) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  let content = fs.readFileSync(filePath);
  if (pathname === "/index.html") {
    if (process.env.UI_HARNESS_MEDIA_FIXTURE) content = Buffer.from(content.toString('utf8').replace('media-src ', "media-src 'self' "));
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

module.exports = server;
