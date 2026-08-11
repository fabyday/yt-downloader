const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const activeJobs = new Map();
let rendererServer = null;

const PLATFORM_BINARY_NAMES = {
  "yt-dlp": process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  ffmpeg: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
};

const DOWNLOAD_QUALITIES = new Set([
  "best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360"
]);
const SPEED_LIMITS = new Set(["", "1M", "2M", "5M", "10M", "20M", "50M"]);
const ENCODING_PRESETS = {
  "youtube-copy": {
    id: "youtube-copy",
    label: "YouTube 원본 유지",
    extension: "mkv",
    copy: true
  },
  "h264-mp4": {
    id: "h264-mp4",
    label: "H.264 MP4",
    extension: "mp4",
    args: [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart"
    ]
  },
  "premiere-prores": {
    id: "premiere-prores",
    label: "Premiere ProRes 422 HQ",
    extension: "mov",
    args: [
      "-c:v",
      "prores_ks",
      "-profile:v",
      "3",
      "-pix_fmt",
      "yuv422p10le",
      "-c:a",
      "pcm_s16le"
    ]
  },
  "davinci-dnxhr": {
    id: "davinci-dnxhr",
    label: "DaVinci DNxHR HQX",
    extension: "mov",
    args: [
      "-c:v",
      "dnxhd",
      "-profile:v",
      "dnxhr_hqx",
      "-pix_fmt",
      "yuv422p10le",
      "-c:a",
      "pcm_s16le"
    ]
  }
};

function createWindow(rendererUrl) {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title: "YT Section Downloader",
    backgroundColor: "#111317",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(rendererUrl);
}

app.whenReady().then(async () => {
  rendererServer = await startRendererServer();
  createWindow(rendererServer.url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(rendererServer.url);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  rendererServer?.server.close();
});

ipcMain.handle("app:get-dependency-status", async () => {
  const [ytDlp, ffmpeg] = await Promise.all([
    getCommandVersion(getConfiguredBinary("yt-dlp", "YT_DLP_PATH"), ["--version"]),
    getCommandVersion(getConfiguredBinary("ffmpeg", "FFMPEG_PATH"), ["-version"])
  ]);

  return { ytDlp, ffmpeg };
});

ipcMain.handle("dialog:select-output-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "저장 폴더 선택",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("download:open-output", async (_event, filePath) => {
  if (!filePath) {
    return false;
  }

  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle("download:cancel", async (_event, jobId) => {
  const job = activeJobs.get(jobId);
  if (!job) {
    return { canceled: false };
  }

  job.canceled = true;
  for (const child of job.children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  return { canceled: true };
});

ipcMain.handle("download:section", async (event, payload) => {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id: jobId, children: [], canceled: false };
  activeJobs.set(jobId, job);

  const send = (stage, message, extra = {}) => {
    event.sender.send("download:progress", {
      jobId,
      stage,
      message,
      ...extra
    });
  };

  let tempDir = null;

  try {
    const request = normalizeDownloadRequest(payload);
    const ytDlpPath = getConfiguredBinary("yt-dlp", "YT_DLP_PATH");
    const ffmpegPath = getConfiguredBinary("ffmpeg", "FFMPEG_PATH");

    send("starting", "다운로드 작업을 준비하는 중입니다.", { progress: 0 });

    await assertCommandAvailable(ytDlpPath, "yt-dlp");
    await assertCommandAvailable(ffmpegPath, "ffmpeg");
    await fs.mkdir(request.outputDir, { recursive: true });

    tempDir = path.join(app.getPath("temp"), "yt-section-downloader", jobId);
    await fs.mkdir(tempDir, { recursive: true });

    const tempTemplate = path.join(tempDir, "source.%(ext)s");
    const outputPaths = getSegmentOutputPaths(
      request.outputDir,
      request.basename,
      request.segments.length,
      request.encodingPreset.extension
    );

    send("downloading", "원본 영상을 임시 파일로 다운로드하는 중입니다.", {
      progress: 0.05
    });

    await runProcess(
      ytDlpPath,
      buildYtDlpArgs({ request, ffmpegPath, tempTemplate }),
      {
        job,
        onLine: (line) => {
          const percent = parseDownloadPercent(line);
          send("downloading", line, {
            progress: percent === null ? undefined : 0.05 + percent * 0.55
          });
        }
      }
    );

    if (job.canceled) {
      throw new Error("작업이 취소되었습니다.");
    }

    const inputPath = await findDownloadedFile(tempDir);
    const segmentCount = request.segments.length;
    const cutProgressStart = 0.6;
    const cutProgressSpan = 0.38;

    for (const [index, segment] of request.segments.entries()) {
      if (job.canceled) {
        throw new Error("작업이 취소되었습니다.");
      }

      const duration = segment.end - segment.start;
      const segmentProgressStart =
        cutProgressStart + (index / segmentCount) * cutProgressSpan;
      const segmentProgressSpan = cutProgressSpan / segmentCount;
      const outputPath = outputPaths[index];
      const ffmpegArgs = buildFfmpegArgs({
        encodingPreset: request.encodingPreset,
        inputPath,
        outputPath,
        start: segment.start,
        duration
      });

      send(
        "cutting",
        request.encodingPreset.copy
          ? `${index + 1}/${segmentCount} 구간을 원본 스트림 유지 방식으로 자르는 중입니다.`
          : `${index + 1}/${segmentCount} 구간을 ${request.encodingPreset.label} 프리셋으로 인코딩하는 중입니다.`,
        {
          progress: segmentProgressStart,
          segmentIndex: index + 1,
          segmentCount,
          outputPath
        }
      );

      await runProcess(ffmpegPath, ffmpegArgs, {
        job,
        onLine: (line) => {
          const cutProgress = parseFfmpegTimeProgress(line, duration);
          send("cutting", line, {
            progress:
              cutProgress === null
                ? undefined
                : segmentProgressStart + cutProgress * segmentProgressSpan,
            segmentIndex: index + 1,
            segmentCount,
            outputPath
          });
        }
      });
    }

    send("done", `${segmentCount}개 구간 파일 저장이 끝났습니다.`, {
      progress: 1,
      outputPath: outputPaths[0],
      outputPaths
    });

    return { ok: true, jobId, outputPath: outputPaths[0], outputPaths };
  } catch (error) {
    send("error", error.message || String(error), { progress: 0 });
    return {
      ok: false,
      jobId,
      error: error.message || String(error)
    };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    activeJobs.delete(jobId);
  }
});

function getConfiguredBinary(defaultName, envName) {
  const configured = process.env[envName];
  if (configured) {
    return configured;
  }

  const bundledBinary = getBundledBinary(defaultName);
  if (bundledBinary) {
    return bundledBinary;
  }

  for (const directory of [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ]) {
    const candidate = path.join(directory, defaultName);
    if (canExecute(candidate)) {
      return candidate;
    }
  }

  return defaultName;
}

function getBundledBinary(defaultName) {
  const executableName = PLATFORM_BINARY_NAMES[defaultName] || defaultName;
  const platformDir = path.join("thirdparty", "bin", process.platform, executableName);
  const candidates = [
    path.join(app.getAppPath(), platformDir),
    path.join(__dirname, "..", "..", platformDir),
    path.join(process.resourcesPath || "", platformDir),
    path.join(process.resourcesPath || "", "app.asar.unpacked", platformDir)
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);

    if (canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

function canExecute(filePath) {
  try {
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function startRendererServer() {
  const rendererRoot = path.join(__dirname, "../renderer");

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      serveRendererFile(rendererRoot, request, response);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/index.html`
      });
    });
  });
}

function serveRendererFile(rendererRoot, request, response) {
  const requestUrl = new URL(request.url, "http://127.0.0.1");
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const resolvedPath = path.resolve(rendererRoot, `.${decodeURIComponent(pathname)}`);

  if (!resolvedPath.startsWith(rendererRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fsSync.readFile(resolvedPath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": getContentType(resolvedPath),
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function getContentType(filePath) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function normalizeDownloadRequest(payload) {
  const url = String(payload?.url || "").trim();
  const outputDir =
    String(payload?.outputDir || "").trim() ||
    path.join(os.homedir(), "Downloads", "YouTube Clips");
  const basename = sanitizeFileName(
    String(payload?.basename || "").trim() || `clip-${new Date().toISOString()}`
  );
  const segments = normalizeDownloadSegments(payload);
  const downloadQuality = normalizeDownloadQuality(payload?.downloadQuality);
  const speedLimit = normalizeSpeedLimit(payload?.speedLimit);
  const encodingPreset = normalizeEncodingPreset(payload);

  if (!isSupportedYouTubeUrl(url)) {
    throw new Error("유효한 YouTube URL을 입력해 주세요.");
  }

  return {
    url,
    segments,
    downloadQuality,
    speedLimit,
    encodingPreset,
    outputDir,
    basename
  };
}

function normalizeDownloadQuality(value) {
  const quality = String(value || "best");
  return DOWNLOAD_QUALITIES.has(quality) ? quality : "best";
}

function normalizeSpeedLimit(value) {
  const speedLimit = String(value || "");
  return SPEED_LIMITS.has(speedLimit) ? speedLimit : "";
}

function normalizeEncodingPreset(payload) {
  if (!payload?.encodingPreset && payload?.mode) {
    return payload.mode === "copy"
      ? ENCODING_PRESETS["youtube-copy"]
      : ENCODING_PRESETS["h264-mp4"];
  }

  return ENCODING_PRESETS[payload?.encodingPreset] || ENCODING_PRESETS["youtube-copy"];
}

function normalizeDownloadSegments(payload) {
  const rawSegments =
    Array.isArray(payload?.segments) && payload.segments.length > 0
      ? payload.segments
      : [{ start: payload?.start, end: payload?.end }];

  if (rawSegments.length > 100) {
    throw new Error("구간은 한 번에 100개 이하로 선택해 주세요.");
  }

  return rawSegments.map((rawSegment, index) => {
    const start = Math.max(0, Number(rawSegment?.start));
    const end = Number(rawSegment?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`${index + 1}번 구간의 끝 지점은 시작 지점보다 뒤에 있어야 합니다.`);
    }

    if (end - start > 60 * 60 * 6) {
      throw new Error(`${index + 1}번 구간이 너무 깁니다. 6시간 이하로 선택해 주세요.`);
    }

    return { start, end };
  });
}

function isSupportedYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

function sanitizeFileName(value) {
  const safe = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return safe || "clip";
}

function getUniqueOutputPath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 1;

  while (require("fs").existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function getSegmentOutputPaths(outputDir, basename, segmentCount, extension) {
  if (segmentCount === 1) {
    return [getUniqueOutputPath(path.join(outputDir, `${basename}.${extension}`))];
  }

  const padWidth = Math.max(2, String(segmentCount).length);

  return Array.from({ length: segmentCount }, (_value, index) => {
    const suffix = String(index + 1).padStart(padWidth, "0");
    return getUniqueOutputPath(path.join(outputDir, `${basename}-${suffix}.${extension}`));
  });
}

function buildYtDlpArgs({ request, ffmpegPath, tempTemplate }) {
  const args = [
    "--no-playlist",
    "--newline",
    "--ffmpeg-location",
    ffmpegPath,
    "-f",
    getYtDlpFormatSelector(request.downloadQuality),
    "--merge-output-format",
    "mkv",
    "-o",
    tempTemplate
  ];

  if (request.speedLimit) {
    args.push("--limit-rate", request.speedLimit);
  }

  args.push(request.url);
  return args;
}

function getYtDlpFormatSelector(downloadQuality) {
  if (downloadQuality === "best") {
    return "bestvideo+bestaudio/best";
  }

  return [
    `bestvideo[height<=${downloadQuality}]+bestaudio`,
    `best[height<=${downloadQuality}]`
  ].join("/");
}

async function getCommandVersion(command, args) {
  try {
    const output = await collectProcessOutput(command, args);
    const version = output.split(/\r?\n/).find(Boolean) || "available";
    return { available: true, command, version };
  } catch (error) {
    return {
      available: false,
      command,
      error: error.code === "ENOENT" ? "not found" : error.message
    };
  }
}

async function assertCommandAvailable(command, displayName) {
  const status = await getCommandVersion(
    command,
    displayName === "ffmpeg" ? ["-version"] : ["--version"]
  );
  if (!status.available) {
    throw new Error(
      `${displayName}를 찾을 수 없습니다. PATH에 설치하거나 ${displayName === "yt-dlp" ? "YT_DLP_PATH" : "FFMPEG_PATH"} 환경변수로 경로를 지정해 주세요.`
    );
  }
}

function collectProcessOutput(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        const error = new Error(`${command} exited with code ${code}`);
        error.code = code;
        reject(error);
      }
    });
  });
}

function runProcess(command, args, { job, onLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    job.children.push(child);

    let buffered = "";
    const lineTail = [];
    const emitLines = (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          const trimmedLine = line.trim();
          lineTail.push(trimmedLine);
          if (lineTail.length > 12) {
            lineTail.shift();
          }
          onLine(trimmedLine);
        }
      }
    };

    child.stdout.on("data", emitLines);
    child.stderr.on("data", emitLines);
    child.on("error", reject);
    child.on("close", (code) => {
      if (buffered.trim()) {
        const trimmedLine = buffered.trim();
        lineTail.push(trimmedLine);
        if (lineTail.length > 12) {
          lineTail.shift();
        }
        onLine(trimmedLine);
      }

      if (job.canceled) {
        reject(new Error("작업이 취소되었습니다."));
      } else if (code === 0) {
        resolve();
      } else {
        const detail = lineTail.length > 0 ? `\n${lineTail.join("\n")}` : "";
        reject(new Error(`${path.basename(command)} exited with code ${code}${detail}`));
      }
    });
  });
}

async function findDownloadedFile(tempDir) {
  const files = await fs.readdir(tempDir);
  const candidates = files
    .filter((file) => /^source\./.test(file))
    .map((file) => path.join(tempDir, file));

  if (candidates.length === 0) {
    throw new Error("다운로드된 임시 파일을 찾지 못했습니다.");
  }

  const withStats = await Promise.all(
    candidates.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath)
    }))
  );

  withStats.sort((a, b) => b.stat.size - a.stat.size);
  return withStats[0].filePath;
}

function buildFfmpegArgs({ encodingPreset, inputPath, outputPath, start, duration }) {
  const common = [
    "-hide_banner",
    "-y",
    "-ss",
    formatTimestamp(start),
    "-t",
    formatTimestamp(duration),
    "-i",
    inputPath
  ];

  if (encodingPreset.copy) {
    return [
      ...common,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      outputPath
    ];
  }

  return [...common, ...encodingPreset.args, outputPath];
}

function formatTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function parseDownloadPercent(line) {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (!match) {
    return null;
  }

  return Math.min(1, Math.max(0, Number(match[1]) / 100));
}

function parseFfmpegTimeProgress(line, duration) {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || duration <= 0) {
    return null;
  }

  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Math.min(1, Math.max(0, seconds / duration));
}
