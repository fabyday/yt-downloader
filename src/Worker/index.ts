export const WORKER_PROTOCOL_VERSION = 1;

export type WorkerOwnershipMode = "standalone" | "hosted";

export interface WorkerLaunchOptions {
  mode: WorkerOwnershipMode;
  ownerPid: number;
  pipeName: string;
  sessionId: string;
  stateDirectory: string;
}
