import type {
  DependencyStatuses,
  DownloadQueueItem,
} from "./types";

export const WORKER_PROTOCOL_VERSION = 1;
export const WORKER_MAX_MESSAGE_BYTES = 6 * 1024 * 1024;

export type WorkerOwnershipMode = "app-owned" | "external-owned";

export interface WorkerLaunchOptions {
  cacheDirectory: string;
  endpoint: string;
  ffmpegPath: string;
  nodeRuntimePath: string;
  ownerPid: number | null;
  ownership: WorkerOwnershipMode;
  sessionId: string;
  stateDirectory: string;
  token: string;
  ytDlpPath: string;
}

export interface WorkerHelloParams {
  clientName: string;
  protocolVersion: number;
  token: string;
}

export interface WorkerHelloResult {
  ownership: WorkerOwnershipMode;
  protocolVersion: number;
  sessionId: string;
  workerPid: number;
}

export interface WorkerRequestMap {
  "worker.hello": WorkerHelloParams;
  "worker.shutdown": Record<string, never>;
  "dependency.get": Record<string, never>;
  "queue.get": Record<string, never>;
  "queue.enqueue": { item: DownloadQueueItem };
  "queue.update": { item: DownloadQueueItem };
  "queue.remove": { itemId: string };
  "queue.removeMany": { itemIds: string[] };
  "queue.clear": Record<string, never>;
  "queue.pause": { itemId: string };
  "queue.resume": { itemId: string };
  "download.cancel": { jobId: string };
}

export interface WorkerResponseMap {
  "worker.hello": WorkerHelloResult;
  "worker.shutdown": { shuttingDown: boolean };
  "dependency.get": DependencyStatuses;
  "queue.get": DownloadQueueItem[];
  "queue.enqueue": DownloadQueueItem[];
  "queue.update": DownloadQueueItem[];
  "queue.remove": DownloadQueueItem[];
  "queue.removeMany": DownloadQueueItem[];
  "queue.clear": DownloadQueueItem[];
  "queue.pause": DownloadQueueItem[];
  "queue.resume": DownloadQueueItem[];
  "download.cancel": { canceled: boolean };
}

export type WorkerMethod = keyof WorkerRequestMap;

export interface WorkerRequestEnvelope<M extends WorkerMethod = WorkerMethod> {
  id: string;
  method: M;
  params: WorkerRequestMap[M];
  type: "request";
}

export interface WorkerSuccessEnvelope<M extends WorkerMethod = WorkerMethod> {
  id: string;
  method: M;
  result: WorkerResponseMap[M];
  type: "response";
}

export interface WorkerErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
  id: string;
  type: "response";
}

export interface WorkerEventMap {
  "queue.changed": { items: DownloadQueueItem[] };
}

export type WorkerEventName = keyof WorkerEventMap;

export interface WorkerEventEnvelope<E extends WorkerEventName = WorkerEventName> {
  event: E;
  payload: WorkerEventMap[E];
  type: "event";
}

export type WorkerIncomingEnvelope =
  | WorkerSuccessEnvelope
  | WorkerErrorEnvelope
  | WorkerEventEnvelope;

export function encodeWorkerMessage(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function isWorkerRequestEnvelope(
  value: unknown,
): value is WorkerRequestEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkerRequestEnvelope>;
  return (
    candidate.type === "request" &&
    typeof candidate.id === "string" &&
    typeof candidate.method === "string" &&
    Boolean(candidate.params && typeof candidate.params === "object")
  );
}
