export interface DownloadSegment {
  start: number;
  end: number;
  key?: string;
}

export interface CompletedDownloadSegment {
  key: string;
  outputPath: string;
}

export interface DownloadRequest {
  url: string;
  segments: DownloadSegment[];
  downloadQuality: string;
  speedLimit: string;
  encodingPreset: string;
  basename: string;
  outputDir: string;
  resumeKey?: string;
  skipSegmentKeys?: string[];
  keepSourceCache?: boolean;
}

export interface DependencyStatus {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
}

export interface DependencyStatuses {
  ytDlp: DependencyStatus;
  ffmpeg: DependencyStatus;
}

export interface DownloadProgress {
  jobId: string;
  stage: string;
  message: string;
  progress?: number;
  segmentIndex?: number;
  segmentCount?: number;
  segmentKey?: string;
  outputPath?: string;
  outputPaths?: string[];
}

export interface DownloadResult {
  ok: boolean;
  jobId: string;
  outputPath?: string;
  outputPaths?: string[];
  completedSegments?: CompletedDownloadSegment[];
  error?: string;
}

export interface YtClipperApi {
  getDependencyStatus(): Promise<DependencyStatuses>;
  selectOutputDir(): Promise<string | null>;
  downloadSection(payload: DownloadRequest): Promise<DownloadResult>;
  cancelDownload(jobId: string): Promise<{ canceled: boolean }>;
  releaseDownloadCache(resumeKey: string): Promise<boolean>;
  loadQueueState(): Promise<string | null>;
  saveQueueState(serialized: string): Promise<boolean>;
  saveQueueStateSync(serialized: string): boolean;
  openOutput(filePath: string): Promise<boolean>;
  onDownloadProgress(handler: (payload: DownloadProgress) => void): () => void;
}
