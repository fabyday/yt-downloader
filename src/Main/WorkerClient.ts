import * as net from "node:net";
import type { Socket } from "node:net";
import type { DownloadQueueItem } from "../Shared/types";
import {
  encodeWorkerMessage,
  WORKER_MAX_MESSAGE_BYTES,
  WORKER_PROTOCOL_VERSION,
  type WorkerEventEnvelope,
  type WorkerHelloResult,
  type WorkerIncomingEnvelope,
  type WorkerMethod,
  type WorkerRequestMap,
  type WorkerResponseMap,
} from "../Shared/workerProtocol";

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
}

export class WorkerClient {
  private buffer = "";
  private readonly endpoint: string;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;
  private readonly queueListeners = new Set<(items: DownloadQueueItem[]) => void>();
  private socket: Socket | null = null;
  private readonly token: string;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint;
    this.token = token;
  }

  async connect(clientName: string): Promise<WorkerHelloResult> {
    if (this.socket && !this.socket.destroyed) {
      throw new Error("Worker client is already connected");
    }

    const socket = await connectSocket(this.endpoint);
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.handleChunk(chunk));
    socket.on("error", (error) => this.handleDisconnect(error));
    socket.on("close", () => this.handleDisconnect(new Error("Worker connection closed")));

    return this.request("worker.hello", {
      clientName,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      token: this.token,
    });
  }

  request<M extends WorkerMethod>(
    method: M,
    params: WorkerRequestMap[M],
    timeoutMs = 30_000,
  ): Promise<WorkerResponseMap[M]> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("Worker is not connected"));
    }

    const id = `${process.pid}-${Date.now()}-${++this.requestSequence}`;
    return new Promise<WorkerResponseMap[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Worker request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as WorkerResponseMap[M]),
        reject,
        timer,
      });
      socket.write(encodeWorkerMessage({ type: "request", id, method, params }));
    });
  }

  onQueueChanged(listener: (items: DownloadQueueItem[]) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.end();
    this.handleDisconnect(new Error("Worker client disconnected"));
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > WORKER_MAX_MESSAGE_BYTES) {
      this.socket?.destroy(new Error("Worker response is too large"));
      return;
    }

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handleMessage(JSON.parse(line) as WorkerIncomingEnvelope);
      } catch (error) {
        this.socket?.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private handleMessage(message: WorkerIncomingEnvelope): void {
    if (message.type === "event") {
      this.handleEvent(message);
      return;
    }
    if (message.type !== "response" || typeof message.id !== "string") return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if ("error" in message) {
      const error = new Error(message.error.message) as Error & { code?: string };
      error.code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  private handleEvent(message: WorkerEventEnvelope): void {
    if (message.event !== "queue.changed") return;
    const items = (message.payload as { items: DownloadQueueItem[] }).items;
    for (const listener of this.queueListeners) listener(items);
  }

  private handleDisconnect(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function connectSocket(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to worker: ${endpoint}`));
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", onError);
      resolve(socket);
    });
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once("error", onError);
  });
}
