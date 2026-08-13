import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as crypto from "node:crypto";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app } from "electron";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../Common/RetCode";
import type { DownloadQueueItem } from "../Shared/types";
import { BaseManager } from "./Manager/BaseManager";
import { WorkerManagerReturnType } from "./Manager/ReturnTypes";
import { WorkerClient } from "./WorkerClient";

type BinaryName = "yt-dlp" | "ffmpeg";

const PLATFORM_BINARY_NAMES: Record<BinaryName, string> = {
  "yt-dlp": process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  ffmpeg: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
};

export class WorkerManager extends BaseManager<WorkerManagerReturnType> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: WorkerClient | null = null;
  private ownsWorker = false;

  async initialize(): Promise<ReturnCode<WorkerManagerReturnType>> {
    if (this.client) {
      return successReturnCode(
        WorkerManagerReturnType.AlreadyInitialized,
        "Download Worker is already initialized",
      );
    }

    try {
      await this.start();
      return successReturnCode(
        WorkerManagerReturnType.Initialized,
        "Download Worker initialized",
      );
    } catch (error) {
      return failureReturnCode(
        WorkerManagerReturnType.InitializationFailed,
        "Download Worker initialization failed",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<WorkerManagerReturnType>> {
    try {
      await this.dispose();
      return successReturnCode(
        WorkerManagerReturnType.Finalized,
        "Download Worker finalized",
      );
    } catch (error) {
      return failureReturnCode(
        WorkerManagerReturnType.FinalizationFailed,
        "Download Worker finalization failed",
        getErrorMessage(error),
      );
    }
  }

  async start(): Promise<void> {
    const externalEndpoint = process.env.YT_DOWNLOADER_WORKER_ENDPOINT?.trim();
    if (externalEndpoint) {
      const token = process.env.YT_DOWNLOADER_WORKER_TOKEN?.trim();
      if (!token) {
        throw new Error(
          "YT_DOWNLOADER_WORKER_TOKEN is required with YT_DOWNLOADER_WORKER_ENDPOINT",
        );
      }
      delete process.env.YT_DOWNLOADER_WORKER_TOKEN;
      this.client = await connectWithRetry(externalEndpoint, token, 20, 100);
      this.ownsWorker = false;
      return;
    }

    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const endpoint = createOwnedEndpoint(sessionId);
    const workerScript = path.resolve(__dirname, "../worker/worker.js");
    if (!fsSync.existsSync(workerScript)) {
      throw new Error(`Worker program is missing: ${workerScript}`);
    }

    const args = [
      workerScript,
      "--ownership",
      "app-owned",
      "--owner-pid",
      String(process.pid),
      "--endpoint",
      endpoint,
      "--session-id",
      sessionId,
      "--state-dir",
      app.getPath("userData"),
      "--cache-dir",
      path.join(app.getPath("temp"), "yt-section-downloader"),
      "--yt-dlp-path",
      getConfiguredBinary("yt-dlp", "YT_DLP_PATH"),
      "--ffmpeg-path",
      getConfiguredBinary("ffmpeg", "FFMPEG_PATH"),
      "--node-runtime",
      process.execPath,
    ];
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        YT_DOWNLOADER_WORKER_TOKEN: token,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.ownsWorker = true;

    let workerError = "";
    child.stderr.on("data", (chunk) => {
      workerError = `${workerError}${chunk.toString()}`.slice(-16_384);
      console.error(`[worker] ${chunk.toString().trimEnd()}`);
    });
    child.stdout.on("data", (chunk) => {
      const output = chunk.toString().trim();
      if (output) console.info(`[worker] ${output}`);
    });

    try {
      this.client = await connectWithRetry(endpoint, token, 80, 100, child);
    } catch (error) {
      if (!child.killed) child.kill("SIGTERM");
      const detail = workerError.trim();
      throw new Error(
        detail ? `${getErrorMessage(error)}\n${detail}` : getErrorMessage(error),
      );
    }
  }

  getClient(): WorkerClient {
    if (!this.client) throw new Error("Worker manager has not started");
    return this.client;
  }

  onQueueChanged(listener: (items: DownloadQueueItem[]) => void): () => void {
    return this.getClient().onQueueChanged(listener);
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client && this.ownsWorker) {
      await client.request("worker.shutdown", {}, 1500).catch(() => null);
    }
    client?.disconnect();

    const child = this.child;
    this.child = null;
    if (child && !child.killed && child.exitCode === null) {
      const exited = await waitForExit(child, 1500);
      if (!exited && !child.killed) child.kill("SIGTERM");
    }
  }
}

async function connectWithRetry(
  endpoint: string,
  token: string,
  attempts: number,
  delayMs: number,
  child?: ChildProcessWithoutNullStreams,
): Promise<WorkerClient> {
  let lastError: unknown = new Error("Worker connection failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`Worker exited with code ${child.exitCode}`);
    }
    const client = new WorkerClient(endpoint, token);
    try {
      await client.connect("yt-section-downloader");
      return client;
    } catch (error) {
      lastError = error;
      client.disconnect();
      await delay(delayMs);
    }
  }
  throw lastError;
}

function createOwnedEndpoint(sessionId: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\yt-section-downloader-${sessionId}`
    : path.join(
        os.tmpdir(),
        `ytd-${process.pid}-${sessionId.slice(0, 8)}.sock`,
      );
}

function getConfiguredBinary(defaultName: BinaryName, envName: string): string {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;

  const bundled = getBundledBinary(defaultName);
  if (bundled) return bundled;

  for (const directory of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]) {
    const candidate = path.join(directory, PLATFORM_BINARY_NAMES[defaultName]);
    if (canExecute(candidate)) return candidate;
  }
  return PLATFORM_BINARY_NAMES[defaultName];
}

function getBundledBinary(defaultName: BinaryName): string | null {
  const executable = PLATFORM_BINARY_NAMES[defaultName];
  const platformDirectory = path.join("thirdparty", "bin", process.platform, executable);
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    path.join(app.getAppPath(), platformDirectory),
    path.join(__dirname, "..", "..", platformDirectory),
    resourcesPath ? path.join(resourcesPath, platformDirectory) : "",
    resourcesPath
      ? path.join(resourcesPath, "app.asar.unpacked", platformDirectory)
      : "",
  ];
  for (const candidate of new Set(candidates.filter(Boolean))) {
    if (canExecute(candidate)) return candidate;
  }
  return null;
}

function canExecute(filePath: string): boolean {
  try {
    fsSync.accessSync(
      filePath,
      process.platform === "win32" ? fsSync.constants.F_OK : fsSync.constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
