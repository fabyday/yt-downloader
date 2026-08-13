/**
 * Main-process return code ranges.
 *
 * 1xxx: application lifecycle
 * 2xxx: renderer HTTP server
 * 3xxx: IPC bridge
 * 4xxx: window lifecycle
 * 5xxx: download Worker lifecycle
 * 6xxx: application updater
 * 7xxx: preferences
 */
export enum ApplicationReturnType {
  Initialized = 1000,
  Finalized = 1001,
  WorkerInitializationFailed = 1010,
  RendererServerInitializationFailed = 1020,
  IpcInitializationFailed = 1030,
  WindowInitializationFailed = 1040,
  PreferenceInitializationFailed = 1050,
  UnexpectedInitializationFailed = 1090,
  FinalizationFailed = 1091,
}

export enum RendererServerReturnType {
  Initialized = 2000,
  Finalized = 2001,
  InitializationFailed = 2090,
  FinalizationFailed = 2091,
}

export enum IpcReturnType {
  Initialized = 3000,
  Finalized = 3001,
  InitializationFailed = 3090,
}

export enum WindowReturnType {
  Initialized = 4000,
  Finalized = 4001,
  InitializationFailed = 4090,
  FinalizationFailed = 4091,
}

export enum WorkerManagerReturnType {
  Initialized = 5000,
  AlreadyInitialized = 5001,
  Finalized = 5002,
  InitializationFailed = 5090,
  FinalizationFailed = 5091,
}

export enum UpdateReturnType {
  Initialized = 6000,
  Finalized = 6001,
  NoUpdate = 6010,
  UpdateAvailable = 6011,
  UpdateDownloaded = 6012,
  UpdateApplied = 6013,
  CheckFailed = 6090,
}

export enum PreferenceReturnType {
  Initialized = 7000,
  Finalized = 7001,
  Retrieved = 7010,
  Saved = 7011,
  InitializationFailed = 7090,
  FinalizationFailed = 7091,
}
