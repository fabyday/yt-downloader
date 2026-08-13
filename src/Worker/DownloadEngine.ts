import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeLocale, type SupportedLocale } from "../Shared/locale";
import { translate as t } from "../Shared/nodeI18n";
import type {
  CompletedDownloadSegment,
  DependencyStatus,
  DependencyStatuses,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadSegment,
} from "../Shared/types";

export const MIN_YT_DLP_VERSION = "2025.11.12";

type BinaryName = "yt-dlp" | "ffmpeg";

interface EncodingPreset {
  args?: string[];
  copy?: boolean;
  extension: string;
  fallbackLabel: string;
  id: string;
  labelKey?: string;
}

interface NormalizedDownloadSegment extends DownloadSegment {
  key: string;
}

interface NormalizedDownloadRequest
  extends Omit<DownloadRequest, "encodingPreset" | "segments" | "skipSegmentKeys"> {
  encodingPreset: EncodingPreset;
  keepSourceCache: boolean;
  locale: SupportedLocale;
  resumeKey: string;
  segments: NormalizedDownloadSegment[];
  skipSegmentKeys: Set<string>;
}

interface DownloadPayload extends Partial<Omit<DownloadRequest, "segments">> {
  end?: unknown;
  mode?: string;
  segments?: Array<Partial<DownloadSegment>>;
  start?: unknown;
}

interface DownloadJob {
  canceled: boolean;
  children: ChildProcessWithoutNullStreams[];
  id: string;
}

interface ProcessExecutionError extends Error {
  code?: string | number | null;
}

interface RunProcessOptions {
  env?: NodeJS.ProcessEnv;
  job: DownloadJob;
  locale: SupportedLocale;
  onLine: (line: string) => void;
}

interface DownloadEngineOptions {
  cacheDirectory: string;
  ffmpegPath: string;
  nodeRuntimePath: string;
  ytDlpPath: string;
}

type ProgressExtra = Omit<
  Partial<DownloadProgress>,
  "jobId" | "message" | "stage"
>;

const DOWNLOAD_QUALITIES = new Set([
  "best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360",
]);
const SPEED_LIMITS = new Set(["", "1M", "2M", "5M", "10M", "20M", "50M"]);
const ENCODING_PRESETS: Record<string, EncodingPreset> = {
  "youtube-copy": {
    id: "youtube-copy",
    fallbackLabel: "YouTube source",
    labelKey: "preset.youtubeCopy.name",
    extension: "mkv",
    copy: true,
  },
  "h264-mp4": {
    id: "h264-mp4",
    fallbackLabel: "H.264 MP4",
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
      "+faststart",
    ],
  },
  "premiere-prores": {
    id: "premiere-prores",
    fallbackLabel: "Premiere ProRes 422 HQ",
    extension: "mov",
    args: [
      "-c:v",
      "prores_ks",
      "-profile:v",
      "3",
      "-pix_fmt",
      "yuv422p10le",
      "-c:a",
      "pcm_s16le",
    ],
  },
  "davinci-dnxhr": {
    id: "davinci-dnxhr",
    fallbackLabel: "DaVinci DNxHR HQX",
    extension: "mov",
    args: [
      "-c:v",
      "dnxhd",
      "-profile:v",
      "dnxhr_hqx",
      "-pix_fmt",
      "yuv422p10le",
      "-c:a",
      "pcm_s16le",
    ],
  },
};

export class DownloadEngine {
  private readonly activeJobs = new Map<string, DownloadJob>();
  private readonly options: DownloadEngineOptions;

  constructor(options: DownloadEngineOptions) {
    this.options = options;
  }

  async getDependencyStatuses(): Promise<DependencyStatuses> {
    const [ytDlp, ffmpeg] = await Promise.all([
      getYtDlpStatus(this.options.ytDlpPath),
      getCommandVersion(this.options.ffmpegPath, ["-version"]),
    ]);
    return { ytDlp, ffmpeg };
  }

  cancel(jobId: string): { canceled: boolean } {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return { canceled: false };
    }

    cancelJob(job);
    return { canceled: true };
  }

  cancelAll(): void {
    for (const job of this.activeJobs.values()) {
      cancelJob(job);
    }
  }

  async execute(
    payload: DownloadRequest,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: DownloadJob = { id: jobId, children: [], canceled: false };
    this.activeJobs.set(jobId, job);

    const send = (stage: string, message: string, extra: ProgressExtra = {}) => {
      onProgress({ jobId, stage, message, ...extra });
    };

    let tempDir: string | null = null;
    let removeTempOnFinish = false;
    let locale = normalizeLocale(payload.locale);

    try {
      const request = normalizeDownloadRequest(payload);
      locale = request.locale;
      send("starting", t(locale, "main.progress.preparing"), { progress: 0 });

      await assertCommandAvailable(this.options.ytDlpPath, "yt-dlp", locale);
      await assertCommandAvailable(this.options.ffmpegPath, "ffmpeg", locale);
      await fs.mkdir(request.outputDir, { recursive: true });

      tempDir = path.join(this.options.cacheDirectory, request.resumeKey);
      await fs.mkdir(tempDir, { recursive: true });
      const cachedCompletedSegments = await readCompletedSegments(tempDir);
      for (const completed of cachedCompletedSegments) {
        if (fsSync.existsSync(completed.outputPath)) {
          request.skipSegmentKeys.add(completed.key);
        }
      }

      const outputPaths = getSegmentOutputPaths(
        request.outputDir,
        request.basename,
        request.segments.length,
        request.encodingPreset.extension,
      );
      const pendingSegments = request.segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => !request.skipSegmentKeys.has(segment.key));

      if (pendingSegments.length === 0) {
        removeTempOnFinish = !request.keepSourceCache;
        const requestedKeys = new Set(request.segments.map((segment) => segment.key));
        const completedSegments = cachedCompletedSegments.filter(
          (segment) =>
            requestedKeys.has(segment.key) && fsSync.existsSync(segment.outputPath),
        );
        send("done", t(locale, "main.progress.alreadyComplete"), {
          progress: 1,
          outputPath: completedSegments[0]?.outputPath,
          outputPaths: completedSegments.map((segment) => segment.outputPath),
        });
        return {
          ok: true,
          jobId,
          outputPath: completedSegments[0]?.outputPath,
          outputPaths: completedSegments.map((segment) => segment.outputPath),
          completedSegments,
        };
      }

      send("downloading", t(locale, "main.progress.downloadingSource"), {
        progress: 0.05,
      });
      const tempTemplate = path.join(tempDir, "source.%(ext)s");
      await runProcess(
        this.options.ytDlpPath,
        buildYtDlpArgs({
          request,
          ffmpegPath: this.options.ffmpegPath,
          nodeRuntimePath: this.options.nodeRuntimePath,
          tempTemplate,
        }),
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          job,
          locale,
          onLine: (line) => {
            const percent = parseDownloadPercent(line);
            send("downloading", line, {
              progress: percent === null ? undefined : 0.05 + percent * 0.55,
            });
          },
        },
      );

      if (job.canceled) {
        throw new Error(t(locale, "main.error.canceled"));
      }

      const inputPath = await findDownloadedFile(tempDir, locale);
      const completedSegments: CompletedDownloadSegment[] = [];
      const segmentCount = pendingSegments.length;
      const cutProgressStart = 0.6;
      const cutProgressSpan = 0.38;

      for (const [pendingIndex, entry] of pendingSegments.entries()) {
        const { segment, index } = entry;
        if (job.canceled) {
          throw new Error(t(locale, "main.error.canceled"));
        }

        const duration = segment.end - segment.start;
        const progressStart =
          cutProgressStart + (pendingIndex / segmentCount) * cutProgressSpan;
        const progressSpan = cutProgressSpan / segmentCount;
        const outputPath = outputPaths[index];
        const partialOutputPath = getPartialOutputPath(outputPath);

        send(
          "cutting",
          request.encodingPreset.copy
            ? t(locale, "main.progress.cuttingCopy", {
                current: pendingIndex + 1,
                total: segmentCount,
              })
            : t(locale, "main.progress.cuttingEncode", {
                current: pendingIndex + 1,
                total: segmentCount,
                preset: getEncodingPresetLabel(request.encodingPreset, locale),
              }),
          {
            progress: progressStart,
            segmentIndex: pendingIndex + 1,
            segmentCount,
            segmentKey: segment.key,
            outputPath,
          },
        );

        await runProcess(
          this.options.ffmpegPath,
          buildFfmpegArgs({
            encodingPreset: request.encodingPreset,
            inputPath,
            outputPath: partialOutputPath,
            start: segment.start,
            duration,
          }),
          {
            job,
            locale,
            onLine: (line) => {
              const progress = parseFfmpegTimeProgress(line, duration);
              send("cutting", line, {
                progress:
                  progress === null
                    ? undefined
                    : progressStart + progress * progressSpan,
                segmentIndex: pendingIndex + 1,
                segmentCount,
                segmentKey: segment.key,
                outputPath,
              });
            },
          },
        );

        await fs.rename(partialOutputPath, outputPath);
        completedSegments.push({ key: segment.key, outputPath });
        await writeCompletedSegments(tempDir, [
          ...cachedCompletedSegments,
          ...completedSegments,
        ]);
        send("segment-done", t(locale, "main.progress.segmentDone", {
          current: pendingIndex + 1,
          total: segmentCount,
        }), {
          progress:
            cutProgressStart +
            ((pendingIndex + 1) / segmentCount) * cutProgressSpan,
          segmentIndex: pendingIndex + 1,
          segmentCount,
          segmentKey: segment.key,
          outputPath,
        });
      }

      send("done", t(locale, "main.progress.allDone", { count: segmentCount }), {
        progress: 1,
        outputPath: completedSegments[0]?.outputPath,
        outputPaths: completedSegments.map((segment) => segment.outputPath),
      });
      removeTempOnFinish = !request.keepSourceCache;
      return {
        ok: true,
        jobId,
        outputPath: completedSegments[0]?.outputPath,
        outputPaths: completedSegments.map((segment) => segment.outputPath),
        completedSegments,
      };
    } catch (error) {
      const message = getDownloadFailureMessage(error, locale);
      send("error", message, { progress: 0 });
      return { ok: false, jobId, error: message };
    } finally {
      if (tempDir && removeTempOnFinish) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
      this.activeJobs.delete(jobId);
    }
  }
}

function cancelJob(job: DownloadJob): void {
  job.canceled = true;
  for (const child of job.children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function normalizeDownloadRequest(
  payload: DownloadPayload | null | undefined,
): NormalizedDownloadRequest {
  const locale = normalizeLocale(payload?.locale);
  const url = String(payload?.url || "").trim();
  const outputDir =
    String(payload?.outputDir || "").trim() ||
    path.join(os.homedir(), "Downloads", "YouTube Clips");
  const basename = sanitizeFileName(
    String(payload?.basename || "").trim() || `clip-${new Date().toISOString()}`,
  );
  const segments = normalizeDownloadSegments(payload, locale);
  const presetId = payload?.encodingPreset;
  const encodingPreset =
    (presetId ? ENCODING_PRESETS[presetId] : undefined) ||
    (payload?.mode === "copy"
      ? ENCODING_PRESETS["youtube-copy"]
      : ENCODING_PRESETS["h264-mp4"]);
  const resumeKey =
    sanitizeResumeKey(String(payload?.resumeKey || "")) || `download-${Date.now()}`;

  if (!isSupportedYouTubeUrl(url)) {
    throw new Error(t(locale, "main.error.invalidUrl"));
  }
  return {
    locale,
    url,
    outputDir,
    basename,
    segments,
    encodingPreset,
    downloadQuality: DOWNLOAD_QUALITIES.has(String(payload?.downloadQuality))
      ? String(payload?.downloadQuality)
      : "best",
    speedLimit: SPEED_LIMITS.has(String(payload?.speedLimit || ""))
      ? String(payload?.speedLimit || "")
      : "",
    resumeKey,
    skipSegmentKeys: new Set(
      Array.isArray(payload?.skipSegmentKeys)
        ? payload.skipSegmentKeys.map(String).filter(Boolean)
        : [],
    ),
    keepSourceCache: payload?.keepSourceCache === true,
  };
}

function normalizeDownloadSegments(
  payload: DownloadPayload | null | undefined,
  locale: SupportedLocale,
): NormalizedDownloadSegment[] {
  const rawSegments =
    Array.isArray(payload?.segments) && payload.segments.length > 0
      ? payload.segments
      : [{ start: payload?.start, end: payload?.end, key: undefined }];
  if (rawSegments.length > 100) {
    throw new Error(t(locale, "main.error.tooManySegments"));
  }

  return rawSegments.map((rawSegment, index) => {
    const start = Math.max(0, Number(rawSegment?.start));
    const end = Number(rawSegment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(t(locale, "main.error.invalidSegment", { index: index + 1 }));
    }
    if (end - start > 60 * 60 * 6) {
      throw new Error(t(locale, "main.error.segmentTooLong", { index: index + 1 }));
    }
    return {
      start,
      end,
      key: rawSegment.key || createSegmentKey(start, end),
    };
  });
}

function buildYtDlpArgs({
  request,
  ffmpegPath,
  nodeRuntimePath,
  tempTemplate,
}: {
  request: NormalizedDownloadRequest;
  ffmpegPath: string;
  nodeRuntimePath: string;
  tempTemplate: string;
}): string[] {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--newline",
    "--continue",
    "--extractor-retries",
    "3",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--no-js-runtimes",
    "--js-runtimes",
    `node:${nodeRuntimePath}`,
    "--ffmpeg-location",
    ffmpegPath,
    "-f",
    getYtDlpFormatSelector(request.downloadQuality),
    "--merge-output-format",
    "mkv",
    "-o",
    tempTemplate,
  ];
  if (request.speedLimit) {
    args.push("--limit-rate", request.speedLimit);
  }
  args.push(request.url);
  return args;
}

function getYtDlpFormatSelector(quality: string): string {
  return quality === "best"
    ? "bestvideo+bestaudio/best"
    : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
}

function buildFfmpegArgs({
  encodingPreset,
  inputPath,
  outputPath,
  start,
  duration,
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
    inputPath,
  ];
  return encodingPreset.copy
    ? [...common, "-c", "copy", "-avoid_negative_ts", "make_zero", outputPath]
    : [...common, ...(encodingPreset.args || []), outputPath];
}

async function assertCommandAvailable(
  command: string,
  name: BinaryName,
  locale: SupportedLocale,
): Promise<void> {
  const status =
    name === "yt-dlp"
      ? await getYtDlpStatus(command)
      : await getCommandVersion(command, ["-version"]);
  if (status.available) {
    return;
  }
  if (status.reason === "outdated") {
    throw new Error(t(locale, "main.error.ytDlpOutdated", {
      version: status.version || "unknown",
      minimum: MIN_YT_DLP_VERSION,
    }));
  }
  throw new Error(t(locale, "main.error.binaryMissing", {
    name,
    env: name === "yt-dlp" ? "YT_DLP_PATH" : "FFMPEG_PATH",
  }));
}

async function getYtDlpStatus(command: string): Promise<DependencyStatus> {
  const status = await getCommandVersion(command, ["--version"]);
  if (!status.available) {
    return { ...status, reason: "missing" };
  }
  if (!isVersionAtLeast(status.version, MIN_YT_DLP_VERSION)) {
    return {
      ...status,
      available: false,
      reason: "outdated",
      minimumVersion: MIN_YT_DLP_VERSION,
    };
  }
  return status;
}

async function getCommandVersion(
  command: string,
  args: string[],
): Promise<DependencyStatus> {
  try {
    const output = await collectProcessOutput(command, args);
    return {
      available: true,
      command,
      version: output.split(/\r?\n/).find(Boolean) || "available",
    };
  } catch (error) {
    const processError = error as ProcessExecutionError;
    return {
      available: false,
      command,
      error: processError.code === "ENOENT" ? "not found" : getErrorMessage(error),
      reason: "missing",
    };
  }
}

function collectProcessOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        const error = new Error(`${command} exited with code ${code}`) as ProcessExecutionError;
        error.code = code;
        reject(error);
      }
    });
  });
}

function runProcess(
  command: string,
  args: string[],
  { env, job, locale, onLine }: RunProcessOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    job.children.push(child);
    let buffered = "";
    const lineTail: string[] = [];
    const emitLines = (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        lineTail.push(line);
        if (lineTail.length > 12) lineTail.shift();
        onLine(line);
      }
    };
    child.stdout.on("data", emitLines);
    child.stderr.on("data", emitLines);
    child.on("error", reject);
    child.on("close", (code) => {
      const line = buffered.trim();
      if (line) {
        lineTail.push(line);
        onLine(line);
      }
      if (job.canceled) {
        reject(new Error(t(locale, "main.error.canceled")));
      } else if (code === 0) {
        resolve();
      } else {
        const detail = lineTail.length ? `\n${lineTail.slice(-12).join("\n")}` : "";
        reject(new Error(`${path.basename(command)} exited with code ${code}${detail}`));
      }
    });
  });
}

async function findDownloadedFile(
  tempDir: string,
  locale: SupportedLocale,
): Promise<string> {
  const candidates = (await fs.readdir(tempDir))
    .filter((file) => /^source\./.test(file) && !/\.(part|ytdl)$/.test(file))
    .map((file) => path.join(tempDir, file));
  if (!candidates.length) {
    throw new Error(t(locale, "main.error.tempFileMissing"));
  }
  const withStats = await Promise.all(candidates.map(async (filePath) => ({
    filePath,
    stat: await fs.stat(filePath),
  })));
  withStats.sort((a, b) => b.stat.size - a.stat.size);
  return withStats[0].filePath;
}

async function readCompletedSegments(
  cacheDir: string,
): Promise<CompletedDownloadSegment[]> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(cacheDir, "completed-segments.json"), "utf8"),
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is CompletedDownloadSegment => Boolean(
          value &&
          typeof value === "object" &&
          typeof (value as CompletedDownloadSegment).key === "string" &&
          typeof (value as CompletedDownloadSegment).outputPath === "string",
        ))
      : [];
  } catch {
    return [];
  }
}

async function writeCompletedSegments(
  cacheDir: string,
  segments: CompletedDownloadSegment[],
): Promise<void> {
  const unique = [...new Map(segments.map((segment) => [segment.key, segment])).values()];
  await fs.writeFile(
    path.join(cacheDir, "completed-segments.json"),
    JSON.stringify(unique),
    "utf8",
  );
}

function getSegmentOutputPaths(
  outputDir: string,
  basename: string,
  count: number,
  extension: string,
): string[] {
  if (count === 1) {
    return [getUniqueOutputPath(path.join(outputDir, `${basename}.${extension}`))];
  }
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_value, index) =>
    getUniqueOutputPath(path.join(
      outputDir,
      `${basename}-${String(index + 1).padStart(width, "0")}.${extension}`,
    )),
  );
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

function getPartialOutputPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.partial${parsed.ext}`);
}

function getEncodingPresetLabel(
  preset: EncodingPreset,
  locale: SupportedLocale,
): string {
  return preset.labelKey ? t(locale, preset.labelKey) : preset.fallbackLabel;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "clip";
}

export function sanitizeResumeKey(value: string): string | null {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return safe || null;
}

function isSupportedYouTubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host);
  } catch {
    return false;
  }
}

function createSegmentKey(start: number, end: number): string {
  return `${start.toFixed(3)}-${end.toFixed(3)}`;
}

function formatTimestamp(value: number): string {
  return Math.max(0, value).toFixed(3);
}

function parseDownloadPercent(line: string): number | null {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i);
  return match ? Math.max(0, Math.min(1, Number(match[1]) / 100)) : null;
}

function parseFfmpegTimeProgress(line: string, duration: number): number | null {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || duration <= 0) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Math.max(0, Math.min(1, seconds / duration));
}

function isVersionAtLeast(version: string | undefined, minimum: string): boolean {
  const current = String(version || "").match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  const required = minimum.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!current || !required) return false;
  return Number(`${current[1]}${current[2]}${current[3]}`) >=
    Number(`${required[1]}${required[2]}${required[3]}`);
}

function getDownloadFailureMessage(error: unknown, locale: SupportedLocale): string {
  const detail = getErrorMessage(error);
  if (/the page needs to be reloaded|nsig extraction failed|no supported javascript runtime|javascript challenge|challenge solver/i.test(detail)) {
    return t(locale, "main.error.youtubeExtraction");
  }
  return detail;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
