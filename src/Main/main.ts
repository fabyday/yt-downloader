import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CompletedDownloadSegment,
  DependencyStatus,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadSegment
} from "../Shared/types";

type BinaryName = "yt-dlp" | "ffmpeg";

interface EncodingPreset {
  id: string;
  label: string;
  extension: string;
  copy?: boolean;
  args?: string[];
}

interface NormalizedDownloadSegment extends DownloadSegment {
  key: string;
}

interface NormalizedDownloadRequest
  extends Omit<
    DownloadRequest,
    "encodingPreset" | "segments" | "skipSegmentKeys"
  > {
  encodingPreset: EncodingPreset;
  segments: NormalizedDownloadSegment[];
  resumeKey: string;
  skipSegmentKeys: Set<string>;
  keepSourceCache: boolean;
}

interface DownloadPayload extends Partial<Omit<DownloadRequest, "segments">> {
  segments?: Array<Partial<DownloadSegment>>;
  start?: unknown;
  end?: unknown;
  mode?: string;
}

interface DownloadJob {
  id: string;
  children: ChildProcessWithoutNullStreams[];
  canceled: boolean;
}

interface RendererServer {
  server: http.Server;
  url: string;
}

interface ProcessExecutionError extends Error {
  code?: string | number | null;
}

interface RunProcessOptions {
  job: DownloadJob;
  onLine: (line: string) => void;
}

type ProgressExtra = Omit<
  Partial<DownloadProgress>,
  "jobId" | "stage" | "message"
>;

const activeJobs = new Map<string, DownloadJob>();
let rendererServer: RendererServer | null = null;
let queueStateRevision = 0;

const PLATFORM_BINARY_NAMES: Record<BinaryName, string> = {
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
const ENCODING_PRESETS: Record<string, EncodingPreset> = {
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

function createWindow(rendererUrl: string): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title: "YT Section Downloader",
    backgroundColor: "#111317",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
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
    if (BrowserWindow.getAllWindows().length === 0 && rendererServer) {
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
  for (const job of activeJobs.values()) {
    job.canceled = true;
    for (const child of job.children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  }
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

ipcMain.handle(
  "download:open-output",
  async (_event: IpcMainInvokeEvent, filePath: string) => {
  if (!filePath) {
    return false;
  }

  shell.showItemInFolder(filePath);
  return true;
  }
);

ipcMain.handle(
  "download:cancel",
  async (_event: IpcMainInvokeEvent, jobId: string) => {
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
  }
);

ipcMain.handle(
  "download:release-cache",
  async (_event: IpcMainInvokeEvent, resumeKey: string) => {
    const safeKey = sanitizeResumeKey(resumeKey);
    if (!safeKey) {
      return false;
    }

    await fs.rm(getDownloadCacheDir(safeKey), { recursive: true, force: true });
    return true;
  }
);

ipcMain.handle("queue:load-state", async () => {
  try {
    return await fs.readFile(getQueueStatePath(), "utf8");
  } catch (error) {
    const processError = error as NodeJS.ErrnoException;
    if (processError.code === "ENOENT") {
      return null;
    }
    throw error;
  }
});

ipcMain.handle(
  "queue:save-state",
  async (_event: IpcMainInvokeEvent, serialized: string) => {
    const stateJson = normalizeQueueStateJson(serialized);
    const revision = ++queueStateRevision;
    await writeQueueState(stateJson, revision);
    return true;
  }
);

ipcMain.on("queue:save-state-sync", (event, serialized: string) => {
  try {
    const stateJson = normalizeQueueStateJson(serialized);
    queueStateRevision += 1;
    const statePath = getQueueStatePath();
    fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
    fsSync.writeFileSync(statePath, stateJson, "utf8");
    event.returnValue = true;
  } catch {
    event.returnValue = false;
  }
});

ipcMain.handle(
  "download:section",
  async (
    event: IpcMainInvokeEvent,
    payload: DownloadPayload
  ): Promise<DownloadResult> => {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: DownloadJob = { id: jobId, children: [], canceled: false };
  activeJobs.set(jobId, job);

  const send = (stage: string, message: string, extra: ProgressExtra = {}) => {
    if (event.sender.isDestroyed()) {
      return;
    }
    event.sender.send("download:progress", {
      jobId,
      stage,
      message,
      ...extra
    });
  };

  let tempDir: string | null = null;
  let removeTempOnFinish = false;

  try {
    const request = normalizeDownloadRequest(payload);
    const ytDlpPath = getConfiguredBinary("yt-dlp", "YT_DLP_PATH");
    const ffmpegPath = getConfiguredBinary("ffmpeg", "FFMPEG_PATH");

    send("starting", "다운로드 작업을 준비하는 중입니다.", { progress: 0 });

    await assertCommandAvailable(ytDlpPath, "yt-dlp");
    await assertCommandAvailable(ffmpegPath, "ffmpeg");
    await fs.mkdir(request.outputDir, { recursive: true });

    tempDir = getDownloadCacheDir(request.resumeKey);
    await fs.mkdir(tempDir, { recursive: true });
    const cachedCompletedSegments = await readCompletedSegments(tempDir);
    for (const completed of cachedCompletedSegments) {
      if (fsSync.existsSync(completed.outputPath)) {
        request.skipSegmentKeys.add(completed.key);
      }
    }

    const tempTemplate = path.join(tempDir, "source.%(ext)s");
    const outputPaths = getSegmentOutputPaths(
      request.outputDir,
      request.basename,
      request.segments.length,
      request.encodingPreset.extension
    );
    const pendingSegments = request.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => !request.skipSegmentKeys.has(segment.key));

    if (pendingSegments.length === 0) {
      removeTempOnFinish = !request.keepSourceCache;
      const requestedKeys = new Set(request.segments.map((segment) => segment.key));
      const completedSegments = cachedCompletedSegments.filter(
        (segment) =>
          requestedKeys.has(segment.key) && fsSync.existsSync(segment.outputPath)
      );
      send("done", "이미 완료된 구간이라 다시 다운로드하지 않았습니다.", {
        progress: 1,
        outputPath: completedSegments[0]?.outputPath,
        outputPaths: completedSegments.map((segment) => segment.outputPath)
      });
      return {
        ok: true,
        jobId,
        outputPath: completedSegments[0]?.outputPath,
        outputPaths: completedSegments.map((segment) => segment.outputPath),
        completedSegments
      };
    }

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
    const segmentCount = pendingSegments.length;
    const cutProgressStart = 0.6;
    const cutProgressSpan = 0.38;
    const completedSegments: CompletedDownloadSegment[] = [];

    for (const [pendingIndex, entry] of pendingSegments.entries()) {
      const { segment, index } = entry;
      if (job.canceled) {
        throw new Error("작업이 취소되었습니다.");
      }

      const duration = segment.end - segment.start;
      const segmentProgressStart =
        cutProgressStart + (pendingIndex / segmentCount) * cutProgressSpan;
      const segmentProgressSpan = cutProgressSpan / segmentCount;
      const outputPath = outputPaths[index];
      const partialOutputPath = getPartialOutputPath(outputPath);
      const ffmpegArgs = buildFfmpegArgs({
        encodingPreset: request.encodingPreset,
        inputPath,
        outputPath: partialOutputPath,
        start: segment.start,
        duration
      });

      send(
        "cutting",
        request.encodingPreset.copy
          ? `${pendingIndex + 1}/${segmentCount} 구간을 원본 스트림 유지 방식으로 자르는 중입니다.`
          : `${pendingIndex + 1}/${segmentCount} 구간을 ${request.encodingPreset.label} 프리셋으로 인코딩하는 중입니다.`,
        {
          progress: segmentProgressStart,
          segmentIndex: pendingIndex + 1,
          segmentCount,
          segmentKey: segment.key,
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
            segmentIndex: pendingIndex + 1,
            segmentCount,
            segmentKey: segment.key,
            outputPath
          });
        }
      });

      await fs.rename(partialOutputPath, outputPath);
      completedSegments.push({ key: segment.key, outputPath });
      await writeCompletedSegments(tempDir, [
        ...cachedCompletedSegments,
        ...completedSegments
      ]);
      send(
        "segment-done",
        `${pendingIndex + 1}/${segmentCount} 구간 저장이 끝났습니다.`,
        {
          progress:
            cutProgressStart +
            ((pendingIndex + 1) / segmentCount) * cutProgressSpan,
          segmentIndex: pendingIndex + 1,
          segmentCount,
          segmentKey: segment.key,
          outputPath
        }
      );
    }

    send("done", `${segmentCount}개 구간 파일 저장이 끝났습니다.`, {
      progress: 1,
      outputPath: completedSegments[0]?.outputPath,
      outputPaths: completedSegments.map((segment) => segment.outputPath)
    });

    removeTempOnFinish = !request.keepSourceCache;
    return {
      ok: true,
      jobId,
      outputPath: completedSegments[0]?.outputPath,
      outputPaths: completedSegments.map((segment) => segment.outputPath),
      completedSegments
    };
  } catch (error) {
    const message = getErrorMessage(error);
    send("error", message, { progress: 0 });
    return {
      ok: false,
      jobId,
      error: message
    };
  } finally {
    if (tempDir && removeTempOnFinish) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    activeJobs.delete(jobId);
  }
  }
);

function getConfiguredBinary(defaultName: BinaryName, envName: string): string {
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

function getBundledBinary(defaultName: BinaryName): string | null {
  const executableName = PLATFORM_BINARY_NAMES[defaultName] || defaultName;
  const platformDir = path.join("thirdparty", "bin", process.platform, executableName);
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    path.join(app.getAppPath(), platformDir),
    path.join(__dirname, "..", "..", platformDir),
    path.join(resourcesPath || "", platformDir),
    path.join(resourcesPath || "", "app.asar.unpacked", platformDir)
  ];
  const seen = new Set<string>();

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

function canExecute(filePath: string): boolean {
  try {
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function startRendererServer(): Promise<RendererServer> {
  const rendererRoot = path.join(__dirname, "../renderer");

  return new Promise<RendererServer>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      serveRendererFile(rendererRoot, request, response);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("렌더러 서버 주소를 확인할 수 없습니다."));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/index.html`
      });
    });
  });
}

function serveRendererFile(
  rendererRoot: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
): void {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
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

function getContentType(filePath: string): string {
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

function normalizeDownloadRequest(
  payload: DownloadPayload | null | undefined
): NormalizedDownloadRequest {
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
  const resumeKey =
    sanitizeResumeKey(String(payload?.resumeKey || "")) ||
    `download-${Date.now()}`;
  const skipSegmentKeys = new Set(
    Array.isArray(payload?.skipSegmentKeys)
      ? payload.skipSegmentKeys.map(String).filter(Boolean)
      : []
  );

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
    basename,
    resumeKey,
    skipSegmentKeys,
    keepSourceCache: payload?.keepSourceCache === true
  };
}

function normalizeDownloadQuality(value: unknown): string {
  const quality = String(value || "best");
  return DOWNLOAD_QUALITIES.has(quality) ? quality : "best";
}

function normalizeSpeedLimit(value: unknown): string {
  const speedLimit = String(value || "");
  return SPEED_LIMITS.has(speedLimit) ? speedLimit : "";
}

function normalizeEncodingPreset(
  payload: DownloadPayload | null | undefined
): EncodingPreset {
  if (!payload?.encodingPreset && payload?.mode) {
    return payload.mode === "copy"
      ? ENCODING_PRESETS["youtube-copy"]
      : ENCODING_PRESETS["h264-mp4"];
  }

  const presetId = payload?.encodingPreset;
  return (
    (presetId ? ENCODING_PRESETS[presetId] : undefined) ||
    ENCODING_PRESETS["youtube-copy"]
  );
}

function normalizeDownloadSegments(
  payload: DownloadPayload | null | undefined
): NormalizedDownloadSegment[] {
  const rawSegments =
    Array.isArray(payload?.segments) && payload.segments.length > 0
      ? payload.segments
      : [{ start: payload?.start, end: payload?.end, key: undefined }];

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

    return {
      start,
      end,
      key: String(rawSegment?.key || createSegmentKey(start, end))
    };
  });
}

function isSupportedYouTubeUrl(rawUrl: string): boolean {
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

function sanitizeFileName(value: string): string {
  const safe = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return safe || "clip";
}

function sanitizeResumeKey(value: string): string | null {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return safe || null;
}

function getDownloadCacheRoot(): string {
  return path.join(app.getPath("temp"), "yt-section-downloader");
}

function getDownloadCacheDir(resumeKey: string): string {
  return path.join(getDownloadCacheRoot(), resumeKey);
}

function getQueueStatePath(): string {
  return path.join(app.getPath("userData"), "download-queue.json");
}

function getCompletedSegmentsPath(cacheDir: string): string {
  return path.join(cacheDir, "completed-segments.json");
}

async function readCompletedSegments(
  cacheDir: string
): Promise<CompletedDownloadSegment[]> {
  try {
    const serialized = await fs.readFile(getCompletedSegmentsPath(cacheDir), "utf8");
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is CompletedDownloadSegment =>
        Boolean(
          value &&
            typeof value === "object" &&
            typeof (value as CompletedDownloadSegment).key === "string" &&
            typeof (value as CompletedDownloadSegment).outputPath === "string"
        )
    );
  } catch {
    return [];
  }
}

async function writeCompletedSegments(
  cacheDir: string,
  segments: CompletedDownloadSegment[]
): Promise<void> {
  const uniqueSegments = [...new Map(
    segments.map((segment) => [segment.key, segment])
  ).values()];
  await fs.writeFile(
    getCompletedSegmentsPath(cacheDir),
    JSON.stringify(uniqueSegments),
    "utf8"
  );
}

function normalizeQueueStateJson(serialized: string): string {
  const stateJson = String(serialized || "");
  if (Buffer.byteLength(stateJson, "utf8") > 5 * 1024 * 1024) {
    throw new Error("다운로드 큐 상태가 너무 큽니다.");
  }
  JSON.parse(stateJson);
  return stateJson;
}

async function writeQueueState(
  stateJson: string,
  revision: number
): Promise<void> {
  const statePath = getQueueStatePath();
  const tempPath = `${statePath}.${revision}.tmp`;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(tempPath, stateJson, "utf8");

  if (revision !== queueStateRevision) {
    await fs.rm(tempPath, { force: true });
    return;
  }

  await fs.rename(tempPath, statePath);
}

function createSegmentKey(start: number, end: number): string {
  return `${start.toFixed(3)}-${end.toFixed(3)}`;
}

function getPartialOutputPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.partial${parsed.ext}`);
}

function getUniqueOutputPath(targetPath: string): string {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 1;

  while (fsSync.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function getSegmentOutputPaths(
  outputDir: string,
  basename: string,
  segmentCount: number,
  extension: string
): string[] {
  if (segmentCount === 1) {
    return [getUniqueOutputPath(path.join(outputDir, `${basename}.${extension}`))];
  }

  const padWidth = Math.max(2, String(segmentCount).length);

  return Array.from({ length: segmentCount }, (_value, index) => {
    const suffix = String(index + 1).padStart(padWidth, "0");
    return getUniqueOutputPath(path.join(outputDir, `${basename}-${suffix}.${extension}`));
  });
}

function buildYtDlpArgs({
  request,
  ffmpegPath,
  tempTemplate
}: {
  request: NormalizedDownloadRequest;
  ffmpegPath: string;
  tempTemplate: string;
}): string[] {
  const args = [
    "--no-playlist",
    "--newline",
    "--continue",
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

function getYtDlpFormatSelector(downloadQuality: string): string {
  if (downloadQuality === "best") {
    return "bestvideo+bestaudio/best";
  }

  return [
    `bestvideo[height<=${downloadQuality}]+bestaudio`,
    `best[height<=${downloadQuality}]`
  ].join("/");
}

async function getCommandVersion(
  command: string,
  args: string[]
): Promise<DependencyStatus> {
  try {
    const output = await collectProcessOutput(command, args);
    const version = output.split(/\r?\n/).find(Boolean) || "available";
    return { available: true, command, version };
  } catch (error) {
    const processError = error as ProcessExecutionError;
    return {
      available: false,
      command,
      error:
        processError.code === "ENOENT" ? "not found" : getErrorMessage(error)
    };
  }
}

async function assertCommandAvailable(
  command: string,
  displayName: BinaryName
): Promise<void> {
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

function collectProcessOutput(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
        const error = new Error(
          `${command} exited with code ${code}`
        ) as ProcessExecutionError;
        error.code = code;
        reject(error);
      }
    });
  });
}

function runProcess(
  command: string,
  args: string[],
  { job, onLine }: RunProcessOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    job.children.push(child);

    let buffered = "";
    const lineTail: string[] = [];
    const emitLines = (chunk: Buffer) => {
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

async function findDownloadedFile(tempDir: string): Promise<string> {
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

function buildFfmpegArgs({
  encodingPreset,
  inputPath,
  outputPath,
  start,
  duration
}: {
  encodingPreset: EncodingPreset;
  inputPath: string;
  outputPath: string;
  start: number;
  duration: number;
}): string[] {
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

  return [...common, ...(encodingPreset.args || []), outputPath];
}

function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function parseDownloadPercent(line: string): number | null {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (!match) {
    return null;
  }

  return Math.min(1, Math.max(0, Number(match[1]) / 100));
}

function parseFfmpegTimeProgress(line: string, duration: number): number | null {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || duration <= 0) {
    return null;
  }

  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Math.min(1, Math.max(0, seconds / duration));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
