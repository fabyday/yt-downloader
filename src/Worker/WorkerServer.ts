import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as net from "node:net";
import type { Socket } from "node:net";
import type { DownloadQueueItem } from "../Shared/types";
import {
  encodeWorkerMessage,
  isWorkerRequestEnvelope,
  WORKER_MAX_MESSAGE_BYTES,
  WORKER_PROTOCOL_VERSION,
  type WorkerEventEnvelope,
  type WorkerLaunchOptions,
  type WorkerMethod,
  type WorkerRequestEnvelope,
  type WorkerResponseMap,
} from "../Shared/workerProtocol";
import { DownloadEngine, sanitizeResumeKey } from "./DownloadEngine";
import { DownloadQueueService } from "./DownloadQueueService";

interface ClientSession {
  authenticated: boolean;
  buffer: string;
  socket: Socket;
}

export async function startWorker(): Promise<void> {
  const options = parseLaunchOptions(process.argv.slice(2));
  delete process.env.YT_DOWNLOADER_WORKER_TOKEN;
  process.title = `yt-downloader-worker:${options.sessionId}`;
  await fs.mkdir(options.stateDirectory, { recursive: true });
  await fs.mkdir(options.cacheDirectory, { recursive: true });

  const engine = new DownloadEngine({
    cacheDirectory: options.cacheDirectory,
    ffmpegPath: options.ffmpegPath,
    nodeRuntimePath: options.nodeRuntimePath,
    ytDlpPath: options.ytDlpPath,
  });
  const clients = new Set<ClientSession>();
  let stateRevision = 0;
  let shutdownPromise: Promise<void> | null = null;
  const statePath = path.join(options.stateDirectory, "download-queue.json");

  const queue = new DownloadQueueService({
    cancel: (jobId) => engine.cancel(jobId),
    execute: (request, onProgress) => engine.execute(request, onProgress),
    load: async () => {
      try {
        return await fs.readFile(statePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    notify: (items) => broadcastQueue(clients, items),
    releaseCache: async (resumeKey) => {
      const safeKey = sanitizeResumeKey(resumeKey);
      if (!safeKey) return;
      await fs.rm(path.join(options.cacheDirectory, safeKey), {
        recursive: true,
        force: true,
      });
    },
    save: async (serialized) => {
      if (Buffer.byteLength(serialized, "utf8") > 5 * 1024 * 1024) {
        throw new Error("Download queue state exceeds 5 MiB");
      }
      JSON.parse(serialized);
      const revision = ++stateRevision;
      const tempPath = `${statePath}.${process.pid}.${revision}.tmp`;
      await fs.writeFile(tempPath, serialized, "utf8");
      if (revision !== stateRevision) {
        await fs.rm(tempPath, { force: true });
        return;
      }
      await replaceFile(tempPath, statePath);
    },
  });

  await queue.initialize();

  const server = net.createServer((socket) => {
    const session: ClientSession = { authenticated: false, buffer: "", socket };
    clients.add(session);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => handleChunk(session, chunk));
    socket.on("error", () => clients.delete(session));
    socket.on("close", () => clients.delete(session));
  });

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      engine.cancelAll();
      for (const client of clients) client.socket.end();
      await queue.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== "win32") {
        await removeOwnedSocket(options.endpoint);
      }
    })();
    return shutdownPromise;
  };

  const handleRequest = async (
    session: ClientSession,
    request: WorkerRequestEnvelope,
  ): Promise<void> => {
    try {
      if (request.method === "worker.hello") {
        const params = request.params as {
          clientName?: unknown;
          protocolVersion?: unknown;
          token?: unknown;
        };
        if (params.token !== options.token) {
          throw createProtocolError("UNAUTHORIZED", "Worker authentication failed");
        }
        if (params.protocolVersion !== WORKER_PROTOCOL_VERSION) {
          throw createProtocolError(
            "PROTOCOL_MISMATCH",
            `Worker protocol ${WORKER_PROTOCOL_VERSION} is required`,
          );
        }
        session.authenticated = true;
        sendResult(session.socket, request, {
          ownership: options.ownership,
          protocolVersion: WORKER_PROTOCOL_VERSION,
          sessionId: options.sessionId,
          workerPid: process.pid,
        });
        return;
      }

      if (!session.authenticated) {
        throw createProtocolError("UNAUTHORIZED", "Call worker.hello first");
      }

      switch (request.method) {
        case "dependency.get":
          sendResult(session.socket, request, await engine.getDependencyStatuses());
          return;
        case "queue.get":
          sendResult(session.socket, request, queue.getSnapshot());
          return;
        case "queue.enqueue":
          sendResult(
            session.socket,
            request,
            await queue.enqueue((request.params as { item: DownloadQueueItem }).item),
          );
          return;
        case "queue.update":
          sendResult(
            session.socket,
            request,
            await queue.update((request.params as { item: DownloadQueueItem }).item),
          );
          return;
        case "queue.remove":
          sendResult(
            session.socket,
            request,
            await queue.remove((request.params as { itemId: string }).itemId),
          );
          return;
        case "queue.removeMany":
          sendResult(
            session.socket,
            request,
            await queue.removeMany((request.params as { itemIds: string[] }).itemIds),
          );
          return;
        case "queue.clear":
          sendResult(session.socket, request, await queue.clear());
          return;
        case "queue.pause":
          sendResult(
            session.socket,
            request,
            await queue.pause((request.params as { itemId: string }).itemId),
          );
          return;
        case "queue.resume":
          sendResult(
            session.socket,
            request,
            await queue.resume((request.params as { itemId: string }).itemId),
          );
          return;
        case "download.cancel":
          sendResult(
            session.socket,
            request,
            engine.cancel((request.params as { jobId: string }).jobId),
          );
          return;
        case "worker.shutdown":
          sendResult(session.socket, request, { shuttingDown: true });
          setImmediate(() => {
            void shutdown().finally(() => process.exit(0));
          });
          return;
        default:
          throw createProtocolError(
            "METHOD_NOT_FOUND",
            `Unknown worker method: ${String(request.method)}`,
          );
      }
    } catch (error) {
      sendError(session.socket, request.id, error);
    }
  };

  const handleChunk = (session: ClientSession, chunk: string): void => {
    session.buffer += chunk;
    if (Buffer.byteLength(session.buffer, "utf8") > WORKER_MAX_MESSAGE_BYTES) {
      session.socket.destroy(new Error("Worker message is too large"));
      return;
    }

    const lines = session.buffer.split("\n");
    session.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as unknown;
        if (!isWorkerRequestEnvelope(request)) {
          throw createProtocolError("INVALID_REQUEST", "Invalid worker request");
        }
        void handleRequest(session, request);
      } catch (error) {
        sendError(session.socket, "unknown", error);
      }
    }
  };

  await listen(server, options.endpoint);
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      endpoint: options.endpoint,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      sessionId: options.sessionId,
      workerPid: process.pid,
    })}\n`,
  );

  const ownerTimer = options.ownerPid
    ? setInterval(() => {
        if (!isProcessAlive(options.ownerPid!)) {
          void shutdown().finally(() => process.exit(0));
        }
      }, 1500)
    : null;
  ownerTimer?.unref();

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

function parseLaunchOptions(args: string[]): WorkerLaunchOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid worker argument near ${key || "<end>"}`);
    }
    values.set(key.slice(2), value);
  }

  const required = (key: string): string => {
    const value = values.get(key)?.trim();
    if (!value) throw new Error(`Missing worker option --${key}`);
    return value;
  };
  const ownership = required("ownership");
  if (ownership !== "app-owned" && ownership !== "external-owned") {
    throw new Error(`Invalid worker ownership: ${ownership}`);
  }
  const ownerPidValue = values.get("owner-pid");
  const ownerPid = ownerPidValue ? Number(ownerPidValue) : null;
  if (ownerPid !== null && (!Number.isInteger(ownerPid) || ownerPid <= 0)) {
    throw new Error("Worker owner PID must be a positive integer");
  }

  const token =
    values.get("token")?.trim() ||
    process.env.YT_DOWNLOADER_WORKER_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing YT_DOWNLOADER_WORKER_TOKEN or worker option --token",
    );
  }

  return {
    cacheDirectory: path.resolve(required("cache-dir")),
    endpoint: required("endpoint"),
    ffmpegPath: required("ffmpeg-path"),
    nodeRuntimePath: required("node-runtime"),
    ownerPid,
    ownership,
    sessionId: required("session-id"),
    stateDirectory: path.resolve(required("state-dir")),
    token,
    ytDlpPath: required("yt-dlp-path"),
  };
}

function sendResult<M extends WorkerMethod>(
  socket: Socket,
  request: WorkerRequestEnvelope<M>,
  result: WorkerResponseMap[M],
): void {
  socket.write(encodeWorkerMessage({
    type: "response",
    id: request.id,
    method: request.method,
    result,
  }));
}

function sendError(socket: Socket, id: string, error: unknown): void {
  const protocolError = error as Error & { code?: string };
  socket.write(encodeWorkerMessage({
    type: "response",
    id,
    error: {
      code: protocolError.code || "WORKER_ERROR",
      message: protocolError.message || String(error),
    },
  }));
}

function broadcastQueue(
  clients: Set<ClientSession>,
  items: DownloadQueueItem[],
): void {
  const event: WorkerEventEnvelope<"queue.changed"> = {
    type: "event",
    event: "queue.changed",
    payload: { items },
  };
  const serialized = encodeWorkerMessage(event);
  for (const client of clients) {
    if (client.authenticated && !client.socket.destroyed) {
      client.socket.write(serialized);
    }
  }
}

function createProtocolError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function listen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    await fs.rm(targetPath, { force: true });
    await fs.rename(tempPath, targetPath);
  }
}

async function removeOwnedSocket(endpoint: string): Promise<void> {
  try {
    const stat = await fs.lstat(endpoint);
    if (stat.isSocket()) await fs.unlink(endpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
