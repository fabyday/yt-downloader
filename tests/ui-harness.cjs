const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.env.UI_HARNESS_PORT || 4173);
const rendererRoot = path.resolve(__dirname, "../build/renderer");
let queueState = null;
let lastRequest = null;

const mockBridge = `(() => {
  let progressHandler = () => {};
  class MockPlayer {
    constructor(_elementId, options) {
      this.options = options;
      this.videoId = options.videoId;
      this.currentTime = 0;
      this.duration = 600;
      this.state = 2;
      setTimeout(() => options.events.onReady(), 0);
    }
    loadVideoById(videoId) {
      this.videoId = videoId;
      this.currentTime = 0;
      setTimeout(() => this.options.events.onStateChange(), 0);
    }
    getCurrentTime() { return this.currentTime; }
    getDuration() { return this.duration; }
    getPlayerState() { return this.state; }
    getVideoData() { return { title: "Mock video", video_id: this.videoId }; }
    pauseVideo() { this.state = 2; this.options.events.onStateChange(); }
    playVideo() { this.state = 1; this.options.events.onStateChange(); }
    seekTo(seconds) { this.currentTime = Number(seconds); }
  }

  window.YT = { Player: MockPlayer, PlayerState: { PLAYING: 1 } };
  window.ytClipper = {
    getDependencyStatus: async () => ({
      ytDlp: { available: true, command: "mock", version: "mock" },
      ffmpeg: { available: true, command: "mock", version: "mock" }
    }),
    selectOutputDir: async () => "C:\\\\Downloads",
    downloadSection: async (payload) => {
      await fetch("/last-request", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const skipped = new Set(payload.skipSegmentKeys || []);
      const completedSegments = payload.segments
        .filter((segment) => !skipped.has(segment.key))
        .map((segment, index) => ({
          key: segment.key,
          outputPath: "C:\\\\Downloads\\\\mock-" + segment.key.replace(/[^0-9.-]/g, "") + ".mp4"
        }));
      for (const completed of completedSegments) {
        progressHandler({
          jobId: "mock-job",
          stage: "segment-done",
          message: "mock segment done",
          progress: 1,
          segmentKey: completed.key,
          outputPath: completed.outputPath
        });
      }
      return {
        ok: true,
        jobId: "mock-job",
        outputPath: completedSegments[0]?.outputPath,
        outputPaths: completedSegments.map((segment) => segment.outputPath),
        completedSegments
      };
    },
    cancelDownload: async () => ({ canceled: true }),
    releaseDownloadCache: async () => true,
    openOutput: async () => true,
    loadQueueState: async () => {
      const response = await fetch("/queue-state");
      const text = await response.text();
      return text || null;
    },
    saveQueueState: async (serialized) => {
      await fetch("/queue-state", { method: "POST", body: serialized });
      return true;
    },
    saveQueueStateSync: (serialized) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/queue-state", false);
      request.send(serialized);
      return request.status === 204;
    },
    onDownloadProgress: (handler) => {
      progressHandler = handler;
      return () => { progressHandler = () => {}; };
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

  const pathname = request.url === "/" ? "/index.html" : request.url;
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
