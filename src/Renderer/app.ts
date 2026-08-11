import type {
  DependencyStatus,
  DownloadProgress,
  DownloadRequest,
  DownloadSegment
} from "../Shared/types";

const LOOP_EPSILON = 0.05;
const SEEK_SETTLE_EPSILON = 0.35;
const QUEUE_LOG_LIMIT = 120;
const DEFAULT_OUTPUT_DIR = "";
interface OutputPreset {
  id: string;
  name: string;
  extension: string;
  container: string;
  video: string;
  audio: string;
  target: string;
}

interface LinkTimeRange {
  start: number;
  end: number | null;
}

interface TimelineSegment extends DownloadSegment {
  id: number;
}

interface KeyedDownloadSegment extends DownloadSegment {
  key: string;
}

type MarkerKind = "start" | "end";
type QueueStatus = "queued" | "running" | "done" | "error";
type TimelineInteraction = "scrub" | "marker" | null;

interface EditorSnapshot {
  startTime: number | null;
  endTime: number | null;
  rangeIsDefault: boolean;
  segments: DownloadSegment[];
}

interface PendingPlayerRequest {
  videoId: string;
  initialRange: LinkTimeRange | null;
  editorRestore: EditorSnapshot | null;
}

interface DownloadQueueItem {
  id: string;
  payload: DownloadRequest;
  title: string;
  segmentsCount: number;
  presetName: string;
  qualityLabel: string;
  speedLabel: string;
  status: QueueStatus;
  progress: number;
  message: string;
  outputPath: string | null;
  outputPaths: string[];
  error: string | null;
  jobId: string | null;
  log: string[];
  completedSegmentKeys: string[];
  currentAttemptKeys: string[];
  editorSnapshot: EditorSnapshot;
}

interface RendererState {
  player: YouTubePlayer | null;
  playerReady: boolean;
  currentTime: number;
  duration: number;
  videoTitle: string;
  startTime: number | null;
  endTime: number | null;
  rangeIsDefault: boolean;
  pendingLinkRange: LinkTimeRange | null;
  pendingEditorRestore: EditorSnapshot | null;
  pendingPlayerRequest: PendingPlayerRequest | null;
  expectedVideoId: string | null;
  segments: TimelineSegment[];
  nextSegmentId: number;
  loopEnabled: boolean;
  isScrubbing: boolean;
  draggingMarker: MarkerKind | null;
  timelineInteraction: TimelineInteraction;
  pendingSeekTime: number | null;
  pendingSeekStartedAt: number;
  lastTimelineSeekAt: number;
  activeJobId: string | null;
  downloadQueue: DownloadQueueItem[];
  activeQueueItemId: string | null;
  isQueueRunning: boolean;
  lastOutputPath: string | null;
  editingQueueItemId: string | null;
}

const OUTPUT_PRESETS: OutputPreset[] = [
  {
    id: "youtube-copy",
    name: "YouTube 원본 유지",
    extension: "mkv",
    container: "MKV",
    video: "원본 스트림 복사",
    audio: "원본 스트림 복사",
    target: "재인코딩 없이 빠르게 저장"
  },
  {
    id: "h264-mp4",
    name: "H.264 MP4",
    extension: "mp4",
    container: "MP4",
    video: "H.264 libx264, CRF 18",
    audio: "AAC 192k",
    target: "일반 공유, Premiere, DaVinci 호환"
  },
  {
    id: "premiere-prores",
    name: "Premiere ProRes 422 HQ",
    extension: "mov",
    container: "MOV",
    video: "Apple ProRes 422 HQ 10-bit",
    audio: "PCM 16-bit",
    target: "Premiere 편집용 중간 코덱"
  },
  {
    id: "davinci-dnxhr",
    name: "DaVinci DNxHR HQX",
    extension: "mov",
    container: "MOV",
    video: "DNxHR HQX 10-bit",
    audio: "PCM 16-bit",
    target: "DaVinci Resolve 편집용 중간 코덱"
  }
];

const state: RendererState = {
  player: null,
  playerReady: false,
  currentTime: 0,
  duration: 0,
  videoTitle: "",
  startTime: null,
  endTime: null,
  rangeIsDefault: true,
  pendingLinkRange: null,
  pendingEditorRestore: null,
  pendingPlayerRequest: null,
  expectedVideoId: null,
  segments: [],
  nextSegmentId: 1,
  loopEnabled: false,
  isScrubbing: false,
  draggingMarker: null,
  timelineInteraction: null,
  pendingSeekTime: null,
  pendingSeekStartedAt: 0,
  lastTimelineSeekAt: 0,
  activeJobId: null,
  downloadQueue: [],
  activeQueueItemId: null,
  isQueueRunning: false,
  lastOutputPath: null,
  editingQueueItemId: null
};
let queuePersistenceReady = false;
let queuePersistTimer: number | null = null;

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

const elements = {
  urlInput: getElement<HTMLInputElement>("#urlInput"),
  loadButton: getElement<HTMLButtonElement>("#loadButton"),
  videoInfo: getElement<HTMLElement>("#videoInfo"),
  videoTitle: getElement<HTMLElement>("#videoTitle"),
  playerStage: getElement<HTMLElement>("#playerStage"),
  player: getElement<HTMLElement>("#player"),
  currentTime: getElement<HTMLElement>("#currentTime"),
  durationTime: getElement<HTMLElement>("#durationTime"),
  timelineShell: getElement<HTMLElement>("#timelineShell"),
  timelineInput: getElement<HTMLInputElement>("#timelineInput"),
  timelineFill: getElement<HTMLElement>("#timelineFill"),
  timelineRange: getElement<HTMLElement>("#timelineRange"),
  timelineSegments: getElement<HTMLElement>("#timelineSegments"),
  currentTimeAnchor: getElement<HTMLElement>("#currentTimeAnchor"),
  startMarkerHandle: getElement<HTMLButtonElement>("#startMarkerHandle"),
  endMarkerHandle: getElement<HTMLButtonElement>("#endMarkerHandle"),
  startTime: getElement<HTMLElement>("#startTime"),
  endTime: getElement<HTMLElement>("#endTime"),
  rangeSummary: getElement<HTMLElement>("#rangeSummary"),
  setStartButton: getElement<HTMLButtonElement>("#setStartButton"),
  setEndButton: getElement<HTMLButtonElement>("#setEndButton"),
  resetSelectionButton: getElement<HTMLButtonElement>("#resetSelectionButton"),
  addSegmentButton: getElement<HTMLButtonElement>("#addSegmentButton"),
  clearSegmentsButton: getElement<HTMLButtonElement>("#clearSegmentsButton"),
  segmentCount: getElement<HTMLElement>("#segmentCount"),
  segmentList: getElement<HTMLElement>("#segmentList"),
  playPauseButton: getElement<HTMLButtonElement>("#playPauseButton"),
  backFineButton: getElement<HTMLButtonElement>("#backFineButton"),
  backButton: getElement<HTMLButtonElement>("#backButton"),
  forwardButton: getElement<HTMLButtonElement>("#forwardButton"),
  forwardFineButton: getElement<HTMLButtonElement>("#forwardFineButton"),
  loopToggle: getElement<HTMLInputElement>("#loopToggle"),
  setupViewButton: getElement<HTMLButtonElement>("#setupViewButton"),
  queueViewButton: getElement<HTMLButtonElement>("#queueViewButton"),
  queueBadge: getElement<HTMLElement>("#queueBadge"),
  setupView: getElement<HTMLElement>("#setupView"),
  queueView: getElement<HTMLElement>("#queueView"),
  setupStatusLabel: getElement<HTMLElement>("#setupStatusLabel"),
  queueSummary: getElement<HTMLElement>("#queueSummary"),
  queueList: getElement<HTMLElement>("#queueList"),
  basenameInput: getElement<HTMLInputElement>("#basenameInput"),
  outputDirInput: getElement<HTMLInputElement>("#outputDirInput"),
  selectFolderButton: getElement<HTMLButtonElement>("#selectFolderButton"),
  downloadQualitySelect: getElement<HTMLSelectElement>("#downloadQualitySelect"),
  speedLimitSelect: getElement<HTMLSelectElement>("#speedLimitSelect"),
  encodingPresetSelect: getElement<HTMLSelectElement>("#encodingPresetSelect"),
  presetDetails: getElement<HTMLElement>("#presetDetails"),
  presetFormatList: getElement<HTMLElement>("#presetFormatList"),
  downloadButton: getElement<HTMLButtonElement>("#downloadButton"),
  progressFill: getElement<HTMLElement>("#progressFill"),
  progressLabel: getElement<HTMLElement>("#progressLabel"),
  logOutput: getElement<HTMLPreElement>("#logOutput"),
  ytDlpStatus: getElement<HTMLElement>("#ytDlpStatus"),
  ffmpegStatus: getElement<HTMLElement>("#ffmpegStatus"),
  openOutputButton: getElement<HTMLButtonElement>("#openOutputButton")
};

elements.outputDirInput.value = DEFAULT_OUTPUT_DIR;

renderEncodingPresetOptions();
renderEncodingPresetDetails();
renderSegmentList();
syncRangeDisplay();
renderDownloadQueue();
loadDependencies();
bindEvents();
loadYouTubeApi();
startTicker();
initializeDownloadQueue();

function bindEvents() {
  elements.loadButton.addEventListener("click", loadVideoFromInput);
  elements.urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadVideoFromInput();
    }
  });

  elements.setStartButton.addEventListener("click", () => setMarker("start"));
  elements.setEndButton.addEventListener("click", () => setMarker("end"));
  elements.resetSelectionButton.addEventListener("click", resetSelectionToFullVideo);
  elements.addSegmentButton.addEventListener("click", addSegmentFromSelection);
  elements.clearSegmentsButton.addEventListener("click", clearSegments);
  elements.encodingPresetSelect.addEventListener("change", renderEncodingPresetDetails);
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.playerStage.addEventListener("click", togglePlayback);
  elements.playerStage.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      togglePlayback();
    }
  });
  elements.backFineButton.addEventListener("click", () => seekRelative(-0.1));
  elements.backButton.addEventListener("click", () => seekRelative(-1));
  elements.forwardButton.addEventListener("click", () => seekRelative(1));
  elements.forwardFineButton.addEventListener("click", () => seekRelative(0.1));
  elements.timelineInput.addEventListener("pointerdown", (event) => {
    if (state.timelineInteraction !== null) {
      return;
    }
    state.timelineInteraction = "scrub";
    state.isScrubbing = true;
    seekTimelineFromPointer(event, true);
  });
  elements.timelineInput.addEventListener("input", scrubTimeline);
  elements.timelineInput.addEventListener("change", finishTimelineScrub);
  elements.timelineInput.addEventListener("pointerup", finishTimelineScrub);
  elements.timelineInput.addEventListener("pointercancel", finishTimelineScrub);
  elements.startMarkerHandle.addEventListener("pointerdown", (event) => {
    beginMarkerDrag(event, "start");
  });
  elements.endMarkerHandle.addEventListener("pointerdown", (event) => {
    beginMarkerDrag(event, "end");
  });
  elements.loopToggle.addEventListener("change", () => {
    state.loopEnabled = elements.loopToggle.checked;
  });

  elements.setupViewButton.addEventListener("click", () => switchDownloadView("setup"));
  elements.queueViewButton.addEventListener("click", () => switchDownloadView("queue"));

  elements.selectFolderButton.addEventListener("click", async () => {
    const directory = await window.ytClipper.selectOutputDir();
    if (directory) {
      elements.outputDirInput.value = directory;
    }
  });

  elements.downloadButton.addEventListener("click", downloadSection);
  elements.openOutputButton.addEventListener("click", () => {
    if (state.lastOutputPath) {
      window.ytClipper.openOutput(state.lastOutputPath);
    }
  });

  window.ytClipper.onDownloadProgress(handleDownloadProgress);
  window.addEventListener("keydown", handleShortcuts);
  window.addEventListener("beforeunload", flushDownloadQueueState);
}

function switchDownloadView(view: "setup" | "queue"): void {
  const showQueue = view === "queue";
  elements.setupViewButton.classList.toggle("active", !showQueue);
  elements.queueViewButton.classList.toggle("active", showQueue);
  elements.setupView.classList.toggle("active", !showQueue);
  elements.setupView.classList.toggle("hidden", showQueue);
  elements.queueView.classList.toggle("active", showQueue);
  elements.queueView.classList.toggle("hidden", !showQueue);
}

async function loadDependencies(): Promise<void> {
  const status = await window.ytClipper.getDependencyStatus();
  renderDependency(elements.ytDlpStatus, "yt-dlp", status.ytDlp);
  renderDependency(elements.ffmpegStatus, "ffmpeg", status.ffmpeg);
}

function renderDependency(
  element: HTMLElement,
  name: string,
  status: DependencyStatus
): void {
  element.classList.toggle("ready", status.available);
  element.classList.toggle("missing", !status.available);
  element.textContent = status.available
    ? `${name}: ${status.version}`
    : `${name}: 필요함`;
}

function renderEncodingPresetOptions(): void {
  const options = OUTPUT_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    return option;
  });

  elements.encodingPresetSelect.replaceChildren(...options);
  elements.encodingPresetSelect.value = "youtube-copy";

  const rows = OUTPUT_PRESETS.map((preset) => {
    const row = document.createElement("div");
    row.className = "format-row";

    const name = document.createElement("div");
    name.className = "format-name";
    name.textContent = `${preset.name} (.${preset.extension})`;

    const meta = document.createElement("div");
    meta.className = "format-meta";
    meta.textContent = `${preset.container} / ${preset.video} / ${preset.audio}`;

    row.append(name, meta);
    return row;
  });

  elements.presetFormatList.replaceChildren(...rows);
}

function renderEncodingPresetDetails(): void {
  const preset = getSelectedOutputPreset();

  const title = document.createElement("div");
  title.className = "preset-title";
  title.textContent = `${preset.name} -> .${preset.extension}`;

  const meta = document.createElement("div");
  meta.className = "preset-meta";
  meta.textContent = `${preset.target} | ${preset.container} / ${preset.video} / ${preset.audio}`;

  elements.presetDetails.replaceChildren(title, meta);
}

function getSelectedOutputPreset(): OutputPreset {
  return (
    OUTPUT_PRESETS.find((preset) => preset.id === elements.encodingPresetSelect.value) ||
    OUTPUT_PRESETS[0]
  );
}

function loadYouTubeApi(): void {
  if (window.YT?.Player) {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = () => {
  if (state.pendingPlayerRequest) {
    const request = state.pendingPlayerRequest;
    state.pendingPlayerRequest = null;
    createOrLoadPlayer(
      request.videoId,
      request.initialRange,
      request.editorRestore
    );
    return;
  }

  const pendingLink = parseYouTubeLink(elements.urlInput.value);
  if (pendingLink.videoId) {
    createOrLoadPlayer(pendingLink.videoId, pendingLink.timeRange);
  }
};

function loadVideoFromInput(): void {
  const link = parseYouTubeLink(elements.urlInput.value);
  const videoId = link.videoId;
  if (!videoId) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  state.editingQueueItemId = null;
  createOrLoadPlayer(videoId, link.timeRange);
  updateDownloadButtonLabel();
  if (!elements.basenameInput.value.trim()) {
    elements.basenameInput.value = `clip-${videoId}`;
  }
}

function createOrLoadPlayer(
  videoId: string,
  initialRange: LinkTimeRange | null = null,
  editorRestore: EditorSnapshot | null = null
): void {
  resetMarkers();
  state.pendingLinkRange = initialRange;
  state.pendingEditorRestore = editorRestore;
  state.expectedVideoId = videoId;
  elements.playerStage.classList.add("has-video");

  if (state.player?.loadVideoById) {
    state.playerReady = false;
    state.player.loadVideoById(videoId);
    window.setTimeout(() => {
      updateVideoMeta();
      updatePlaybackButton();
    }, 200);
    return;
  }

  if (!window.YT?.Player) {
    state.pendingPlayerRequest = { videoId, initialRange, editorRestore };
    setProgressLabel("YouTube 플레이어 API를 불러오는 중입니다.");
    return;
  }

  state.player = new window.YT.Player("player", {
    videoId,
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 0,
      cc_load_policy: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      origin: window.location.origin,
      playsinline: 1,
      rel: 0,
      showinfo: 0
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        updateDuration();
        updateVideoMeta();
        updatePlaybackButton();
        renderTimeline();
        setProgressLabel("미리보기 준비 완료");
      },
      onStateChange: handlePlayerStateChange
    }
  });
}

function resetMarkers(): void {
  state.startTime = null;
  state.endTime = null;
  state.rangeIsDefault = true;
  state.pendingLinkRange = null;
  state.pendingEditorRestore = null;
  state.segments = [];
  state.nextSegmentId = 1;
  state.currentTime = 0;
  state.duration = 0;
  state.videoTitle = "";
  state.isScrubbing = false;
  state.draggingMarker = null;
  state.timelineInteraction = null;
  state.pendingSeekTime = null;
  state.pendingSeekStartedAt = 0;
  elements.videoTitle.textContent = "";
  elements.videoInfo.classList.add("hidden");
  elements.startTime.textContent = "--:--.---";
  elements.endTime.textContent = "--:--.---";
  elements.durationTime.textContent = "--:--.---";
  elements.timelineInput.value = "0";
  elements.timelineInput.max = "0";
  elements.timelineInput.disabled = true;
  syncRangeDisplay();
  renderTimeline();
  renderSegmentList();
}

function startTicker(): void {
  window.setInterval(() => {
    if (!state.playerReady || !state.player?.getCurrentTime) {
      return;
    }

    updateDuration();
    const playerTime = state.player.getCurrentTime();
    reconcilePendingSeek(playerTime);

    if (!state.isScrubbing && !state.draggingMarker) {
      if (state.pendingSeekTime === null) {
        state.currentTime = playerTime;
      }
      renderTimeline();
    }

    if (
      state.pendingSeekTime === null &&
      state.loopEnabled &&
      state.startTime !== null &&
      state.endTime !== null &&
      state.endTime > state.startTime &&
      state.currentTime >= state.endTime - LOOP_EPSILON
    ) {
      state.player.seekTo(state.startTime, true);
      state.player.playVideo();
    }
  }, 50);
}

function setMarker(kind: MarkerKind): void {
  if (!state.playerReady) {
    setProgressLabel("먼저 영상을 불러와 주세요.");
    return;
  }

  state.rangeIsDefault = false;
  state.pendingLinkRange = null;
  const current = getCurrentTimelineTime();
  if (kind === "start") {
    state.startTime = current;
    elements.startTime.textContent = formatTime(current);
    if (state.endTime !== null && state.endTime <= current) {
      state.endTime = null;
      elements.endTime.textContent = "--:--.---";
    }
  } else {
    state.endTime = current;
    elements.endTime.textContent = formatTime(current);
  }

  syncRangeDisplay();
  renderTimeline();
  updateDownloadButtonLabel();
}

function resetSelectionToFullVideo(): void {
  if (!applyFullVideoRange()) {
    setProgressLabel("먼저 영상을 불러와 주세요.");
    return;
  }

  state.pendingLinkRange = null;
  state.segments = [];
  state.nextSegmentId = 1;
  renderSegmentList();
  renderTimeline();
  setProgressLabel("다운로드 범위를 전체 영상으로 초기화했습니다.");
}

function applyFullVideoRange(): boolean {
  if (state.duration <= 0) {
    return false;
  }

  state.startTime = 0;
  state.endTime = state.duration;
  state.rangeIsDefault = true;
  syncRangeDisplay();
  updateDownloadButtonLabel();
  return true;
}

function applyLinkTimeRange(range: LinkTimeRange | null): boolean {
  state.pendingLinkRange = null;

  if (!range || state.duration <= 0) {
    return false;
  }

  const start = clampTime(range.start ?? 0);
  const end = clampTime(range.end ?? state.duration);

  if (end <= start) {
    applyFullVideoRange();
    setProgressLabel("링크 시간대가 유효하지 않아 전체 영상으로 설정했습니다.");
    return false;
  }

  state.startTime = start;
  state.endTime = end;
  state.rangeIsDefault =
    start === 0 && Math.abs(state.duration - end) < 0.01;
  syncRangeDisplay();
  updateDownloadButtonLabel();
  renderTimeline();

  if (start > 0 && state.playerReady) {
    seekToTimelineTime(start, true);
  }

  setProgressLabel(
    range.end === null
      ? "링크 시작 시간을 구간 시작점으로 적용했습니다."
      : "링크 시간대를 구간으로 적용했습니다."
  );
  return true;
}

function applyEditorSnapshot(snapshot: EditorSnapshot): void {
  state.pendingEditorRestore = null;
  const restoredSegments = snapshot.segments
    .map((segment) => ({
      start: clampTime(segment.start),
      end: clampTime(segment.end),
      key: segment.key || createSegmentKey(segment.start, segment.end)
    }))
    .filter((segment) => segment.end > segment.start);

  state.segments = restoredSegments.map((segment, index) => ({
    ...segment,
    id: index + 1
  }));
  state.nextSegmentId = state.segments.length + 1;
  state.startTime =
    snapshot.startTime === null ? null : clampTime(snapshot.startTime);
  state.endTime = snapshot.endTime === null ? null : clampTime(snapshot.endTime);

  if (
    state.startTime === null ||
    state.endTime === null ||
    state.endTime <= state.startTime
  ) {
    const firstSegment = state.segments[0];
    if (firstSegment) {
      state.startTime = firstSegment.start;
      state.endTime = firstSegment.end;
    } else {
      applyFullVideoRange();
    }
  }

  state.rangeIsDefault =
    snapshot.rangeIsDefault &&
    state.startTime === 0 &&
    state.endTime !== null &&
    Math.abs(state.duration - state.endTime) < 0.01;
  syncRangeDisplay();
  renderSegmentList();
  renderTimeline();
  updateDownloadButtonLabel();
  if (state.startTime !== null && state.playerReady) {
    seekToTimelineTime(state.startTime, true);
  }
}

function syncRangeDisplay(): void {
  elements.startTime.textContent =
    state.startTime === null ? "--:--.---" : formatTime(state.startTime);
  elements.endTime.textContent =
    state.endTime === null ? "--:--.---" : formatTime(state.endTime);
  elements.resetSelectionButton.disabled = state.duration <= 0;

  if (
    state.startTime !== null &&
    state.endTime !== null &&
    state.endTime > state.startTime
  ) {
    const label = state.rangeIsDefault ? "전체 영상" : "선택 구간";
    elements.rangeSummary.textContent = `${label} · ${formatTime(
      state.endTime - state.startTime
    )}`;
    return;
  }

  elements.rangeSummary.textContent = "구간 미지정";
}

function addSegmentFromSelection(): void {
  const segment = getSelectionSegment();
  if (!segment) {
    return;
  }

  state.segments.push({
    id: state.nextSegmentId,
    start: segment.start,
    end: segment.end,
    key: createSegmentKey(segment.start, segment.end)
  });
  state.nextSegmentId += 1;
  state.segments.sort((a, b) => a.start - b.start || a.end - b.end);

  renderSegmentList();
  renderTimeline();
  setProgressLabel(`구간 ${state.segments.length}개가 목록에 있습니다.`);
}

function clearSegments(): void {
  if (state.segments.length === 0) {
    return;
  }

  state.segments = [];
  renderSegmentList();
  renderTimeline();
  setProgressLabel("구간 목록을 비웠습니다.");
}

function removeSegment(segmentId: number): void {
  state.segments = state.segments.filter((segment) => segment.id !== segmentId);
  renderSegmentList();
  renderTimeline();
  setProgressLabel(`구간 ${state.segments.length}개가 목록에 있습니다.`);
}

function loadSegmentToMarkers(segment: TimelineSegment): void {
  state.startTime = segment.start;
  state.endTime = segment.end;
  state.rangeIsDefault = false;
  syncRangeDisplay();

  if (state.playerReady) {
    seekToTimelineTime(segment.start, true);
  } else {
    renderTimeline();
  }
}

function getSelectionSegment(): DownloadSegment | null {
  if ((state.startTime === null || state.endTime === null) && state.duration > 0) {
    applyFullVideoRange();
  }

  if (state.startTime === null || state.endTime === null) {
    setProgressLabel("시작 지점과 끝 지점을 먼저 설정해 주세요.");
    return null;
  }

  if (state.endTime <= state.startTime) {
    setProgressLabel("끝 지점은 시작 지점보다 뒤에 있어야 합니다.");
    return null;
  }

  return {
    start: Math.max(0, state.startTime),
    end: state.endTime
  };
}

function getDownloadSegments(): DownloadSegment[] | null {
  if (state.segments.length > 0) {
    return state.segments.map((segment) => ({
      start: segment.start,
      end: segment.end
    }));
  }

  const segment = getSelectionSegment();
  return segment ? [segment] : null;
}

function renderSegmentList(): void {
  const count = state.segments.length;
  elements.segmentCount.textContent = `${count}개`;
  elements.clearSegmentsButton.disabled = count === 0;
  elements.segmentList.classList.toggle("empty", count === 0);
  updateDownloadButtonLabel();

  if (count === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "시작/끝 지점을 설정한 뒤 구간을 추가하세요.";
    elements.segmentList.replaceChildren(emptyMessage);
    return;
  }

  const rows = state.segments.map((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment-row";

    const main = document.createElement("div");
    main.className = "segment-main";

    const title = document.createElement("div");
    title.className = "segment-title";
    title.textContent = `구간 ${index + 1}`;

    const times = document.createElement("div");
    times.className = "segment-times";
    times.textContent = `${formatTime(segment.start)} - ${formatTime(segment.end)} (${formatTime(segment.end - segment.start)})`;

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.textContent = "보기";
    previewButton.addEventListener("click", () => loadSegmentToMarkers(segment));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", () => removeSegment(segment.id));

    main.append(title, times);
    row.append(main, previewButton, removeButton);
    return row;
  });

  elements.segmentList.replaceChildren(...rows);
}

function updateDownloadButtonLabel(): void {
  const count = state.segments.length;
  if (getEditingQueueItem()) {
    elements.downloadButton.textContent = "기존 큐에 새 구간 업데이트";
    return;
  }

  if (count === 0 && state.rangeIsDefault && state.startTime !== null && state.endTime !== null) {
    elements.downloadButton.textContent = "전체 영상 큐에 추가";
    return;
  }

  elements.downloadButton.textContent =
    count > 0 ? `${count}개 구간 큐에 추가` : "선택 구간 큐에 추가";
}

function togglePlayback(): void {
  if (!state.playerReady || !state.player) {
    return;
  }

  const playerState = state.player.getPlayerState();
  if (playerState === window.YT?.PlayerState.PLAYING) {
    state.player.pauseVideo();
  } else {
    state.player.playVideo();
  }
}

function handlePlayerStateChange(): void {
  const videoId = state.player?.getVideoData?.().video_id;
  if (state.expectedVideoId && videoId && videoId !== state.expectedVideoId) {
    return;
  }

  state.playerReady = Boolean(state.player);
  updateDuration();
  updateVideoMeta();
  updatePlaybackButton();
}

function updatePlaybackButton(): void {
  if (!state.playerReady || !state.player) {
    return;
  }

  const playerState = state.player.getPlayerState();
  const playing = playerState === window.YT?.PlayerState.PLAYING;
  elements.playPauseButton.textContent = playing ? "정지" : "재생";
  updateVideoMeta();
}

function seekRelative(delta: number): void {
  if (!state.playerReady) {
    return;
  }

  const next = getCurrentTimelineTime() + delta;
  seekToTimelineTime(next, true);
}

function seekTimelineFromPointer(event: PointerEvent, forceSeek: boolean): void {
  if (!state.playerReady || state.duration <= 0) {
    return;
  }

  const rect = elements.timelineInput.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
  requestTimelineSeek(ratio * state.duration, true, forceSeek);
}

function scrubTimeline(event: Event): void {
  if (!state.playerReady || state.timelineInteraction !== "scrub") {
    return;
  }

  const next = Number((event.target as HTMLInputElement).value);
  requestTimelineSeek(next, true, false);
}

function finishTimelineScrub(): void {
  if (state.timelineInteraction !== "scrub") {
    return;
  }

  if (!state.playerReady) {
    state.isScrubbing = false;
    state.timelineInteraction = null;
    return;
  }

  seekToTimelineTime(Number(elements.timelineInput.value), true);
  state.isScrubbing = false;
  state.timelineInteraction = null;
}

function beginMarkerDrag(event: PointerEvent, marker: MarkerKind): void {
  if (
    !state.playerReady ||
    state.duration <= 0 ||
    state.timelineInteraction !== null
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  state.timelineInteraction = "marker";
  state.draggingMarker = marker;
  const target = event.currentTarget as HTMLButtonElement;
  target.setPointerCapture(event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    updateMarkerFromPointer(marker, moveEvent.clientX);
  };

  const stop = (stopEvent: PointerEvent) => {
    try {
      target.releasePointerCapture(stopEvent.pointerId);
    } catch {
      // Pointer capture can already be gone if the drag is canceled by the OS.
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    state.draggingMarker = null;
    state.timelineInteraction = null;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  updateMarkerFromPointer(marker, event.clientX);
}

function updateMarkerFromPointer(marker: MarkerKind, clientX: number): void {
  const rect = elements.timelineInput.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  let next = clampTime(ratio * state.duration);
  state.rangeIsDefault = false;
  state.pendingLinkRange = null;

  if (marker === "start") {
    if (state.endTime !== null) {
      next = Math.min(next, Math.max(0, state.endTime - 0.01));
    }
    state.startTime = next;
    elements.startTime.textContent = formatTime(next);
  } else {
    if (state.startTime !== null) {
      next = Math.max(next, state.startTime + 0.01);
    }
    state.endTime = next;
    elements.endTime.textContent = formatTime(next);
  }

  seekToTimelineTime(next, true);
  syncRangeDisplay();
  renderTimeline();
}

function handleShortcuts(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (event.key === "a" || event.key === "A") {
    setMarker("start");
    return;
  }

  if (event.key === "s" || event.key === "S") {
    setMarker("end");
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekRelative(event.shiftKey ? -5 : -1);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    seekRelative(event.shiftKey ? 5 : 1);
  }
}

function downloadSection(): void {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  const selectedSegments = getDownloadSegments();
  if (!selectedSegments) {
    return;
  }

  const segments = selectedSegments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    key: segment.key || createSegmentKey(segment.start, segment.end)
  }));

  const basename =
    elements.basenameInput.value.trim() || `clip-${new Date().toISOString()}`;
  const preset = getSelectedOutputPreset();
  const editingItem = getEditingQueueItem();

  if (
    editingItem &&
    extractVideoId(editingItem.payload.url) === videoId
  ) {
    updateExistingQueueItem(editingItem, segments, basename, preset);
    return;
  }

  const itemId = createQueueItemId();
  const payload: DownloadRequest = {
    url,
    segments,
    downloadQuality: elements.downloadQualitySelect.value,
    speedLimit: elements.speedLimitSelect.value,
    encodingPreset: elements.encodingPresetSelect.value,
    basename,
    outputDir: elements.outputDirInput.value.trim(),
    resumeKey: itemId,
    skipSegmentKeys: [],
    keepSourceCache: true
  };
  const item: DownloadQueueItem = {
    id: itemId,
    payload,
    title: basename,
    segmentsCount: segments.length,
    presetName: preset.name,
    qualityLabel: getSelectedOptionText(elements.downloadQualitySelect),
    speedLabel: getSelectedOptionText(elements.speedLimitSelect),
    status: "queued",
    progress: 0,
    message: "대기 중",
    outputPath: null,
    outputPaths: [],
    error: null,
    jobId: null,
    log: [],
    completedSegmentKeys: [],
    currentAttemptKeys: [],
    editorSnapshot: captureEditorSnapshot(segments)
  };

  appendQueueLog(item, "[queue] 작업이 큐에 추가됨");
  state.downloadQueue.push(item);
  state.editingQueueItemId = item.id;
  setProgressLabel(`큐에 추가됨: ${item.title}`);
  renderDownloadQueue();
  switchDownloadView("queue");
  runDownloadQueue();
}

function updateExistingQueueItem(
  item: DownloadQueueItem,
  selectedSegments: DownloadSegment[],
  basename: string,
  preset: OutputPreset
): void {
  const existingSegments = item.payload.segments.map(normalizeSegmentKey);
  const existingKeys = new Set(existingSegments.map((segment) => segment.key));
  const addedSegments = selectedSegments
    .map(normalizeSegmentKey)
    .filter((segment) => !existingKeys.has(segment.key));

  if (addedSegments.length === 0) {
    setProgressLabel("기존 큐에 없는 새 구간을 먼저 추가해 주세요.");
    return;
  }

  const mergedSegments = [...existingSegments, ...addedSegments].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
  item.payload = {
    url: elements.urlInput.value.trim(),
    segments: mergedSegments,
    downloadQuality: elements.downloadQualitySelect.value,
    speedLimit: elements.speedLimitSelect.value,
    encodingPreset: elements.encodingPresetSelect.value,
    basename,
    outputDir: elements.outputDirInput.value.trim(),
    resumeKey: item.id,
    skipSegmentKeys: [...item.completedSegmentKeys],
    keepSourceCache: true
  };
  item.title = basename;
  item.segmentsCount = mergedSegments.length;
  item.presetName = preset.name;
  item.qualityLabel = getSelectedOptionText(elements.downloadQualitySelect);
  item.speedLabel = getSelectedOptionText(elements.speedLimitSelect);
  item.editorSnapshot = captureEditorSnapshot(mergedSegments);
  item.error = null;

  if (item.status === "running") {
    item.message = `${addedSegments.length}개 구간 추가됨 · 현재 작업 후 이어서 처리`;
  } else {
    item.status = "queued";
    item.progress = getCompletedProgress(item);
    item.message = `${addedSegments.length}개 새 구간 다운로드 대기`;
  }

  appendQueueLog(item, `[update] 새 구간 ${addedSegments.length}개 추가`);
  state.segments = mergedSegments.map((segment, index) => ({
    ...segment,
    id: index + 1
  }));
  state.nextSegmentId = state.segments.length + 1;
  renderSegmentList();
  renderTimeline();
  renderDownloadQueue();
  setProgressLabel(`기존 큐에 새 구간 ${addedSegments.length}개를 추가했습니다.`);
  switchDownloadView("queue");
  runDownloadQueue();
}

function handleDownloadProgress(payload: DownloadProgress): void {
  const item = getActiveQueueItem();
  if (item) {
    if (payload.jobId && !item.jobId) {
      item.jobId = payload.jobId;
      state.activeJobId = payload.jobId;
    }

    if (payload.stage === "segment-done" && payload.segmentKey) {
      markSegmentCompleted(item, payload.segmentKey, payload.outputPath);
    } else if (payload.progress !== undefined) {
      const completedWeight = item.completedSegmentKeys.length;
      const attemptWeight = item.currentAttemptKeys.length;
      item.progress = clampProgress(
        (completedWeight + payload.progress * attemptWeight) /
          Math.max(1, item.payload.segments.length)
      );
    }

    if (payload.message) {
      item.message = payload.message;
      appendQueueLog(item, `[${payload.stage || "progress"}] ${payload.message}`);
    }

    if (payload.stage === "segment-done" && payload.outputPath) {
      state.lastOutputPath = payload.outputPath;
    }

    renderDownloadQueue();
    if (payload.stage === "segment-done") {
      flushDownloadQueueState();
    }
    return;
  }

  if (payload.progress !== undefined) {
    setProgress(payload.progress);
  }

  if (payload.message) {
    setProgressLabel(payload.message);
    appendLog(`[${payload.stage}] ${payload.message}`);
  }
}

async function runDownloadQueue(): Promise<void> {
  if (state.isQueueRunning) {
    return;
  }

  state.isQueueRunning = true;

  try {
    while (true) {
      const item = state.downloadQueue.find((queueItem) => queueItem.status === "queued");
      if (!item) {
        break;
      }

      const pendingSegments = getPendingSegments(item);
      if (pendingSegments.length === 0) {
        item.status = "done";
        item.progress = 1;
        item.message = "완료";
        renderDownloadQueue();
        continue;
      }

      state.activeQueueItemId = item.id;
      state.activeJobId = null;
      item.status = "running";
      item.currentAttemptKeys = pendingSegments.map((segment) => segment.key);
      item.progress = getCompletedProgress(item);
      item.message =
        item.completedSegmentKeys.length > 0
          ? "중단 지점부터 다운로드 재개 중"
          : "다운로드 시작 중";
      item.error = null;
      item.log = [];
      appendQueueLog(item, "[start] 다운로드 시작");
      renderDownloadQueue();

      try {
        const request: DownloadRequest = {
          ...item.payload,
          resumeKey: item.id,
          skipSegmentKeys: [...item.completedSegmentKeys],
          keepSourceCache: true
        };
        const result = await window.ytClipper.downloadSection(request);
        if (result?.ok) {
          const completedSegments = Array.isArray(result.completedSegments)
            ? result.completedSegments
            : [];
          for (const completed of completedSegments) {
            markSegmentCompleted(item, completed.key, completed.outputPath);
          }

          if (completedSegments.length === 0) {
            for (const key of item.currentAttemptKeys) {
              markSegmentCompleted(item, key);
            }
          }

          const outputPaths = Array.isArray(result.outputPaths)
            ? result.outputPaths.filter(Boolean)
            : [];
          const outputPath = result.outputPath || outputPaths[0] || null;

          for (const path of outputPaths) {
            if (!item.outputPaths.includes(path)) {
              item.outputPaths.push(path);
            }
          }
          item.outputPath = outputPath || item.outputPath;
          const remaining = getPendingSegments(item);
          item.status = remaining.length > 0 ? "queued" : "done";
          item.progress = getCompletedProgress(item);
          item.message =
            remaining.length > 0
              ? `새 구간 ${remaining.length}개 이어서 처리 대기`
              : `완료: 파일 ${item.outputPaths.length}개 생성`;
          state.lastOutputPath = item.outputPath;
          appendQueueLog(item, `[done] ${item.message}`);
        } else {
          const message = result?.error || "다운로드에 실패했습니다.";
          item.status = "error";
          item.error = message;
          item.message = message;
          appendQueueLog(item, `[error] ${message}`);
        }
      } catch (error) {
        const message = getErrorMessage(error) || "다운로드에 실패했습니다.";
        item.status = "error";
        item.error = message;
        item.message = message;
        appendQueueLog(item, `[error] ${message}`);
      }

      item.currentAttemptKeys = [];
      state.activeQueueItemId = null;
      state.activeJobId = null;
      renderDownloadQueue();
    }
  } finally {
    state.isQueueRunning = false;
    renderDownloadQueue();
  }
}

function renderDownloadQueue(): void {
  const runningCount = state.downloadQueue.filter((item) => item.status === "running").length;
  const queuedCount = state.downloadQueue.filter((item) => item.status === "queued").length;
  const activeCount = runningCount + queuedCount;

  elements.queueBadge.textContent = String(activeCount);
  elements.queueSummary.textContent =
    runningCount > 0
      ? `진행 중 ${runningCount}개 · 대기 ${queuedCount}개`
      : `대기 중 ${queuedCount}개`;

  elements.queueList.classList.toggle("empty", state.downloadQueue.length === 0);

  if (state.downloadQueue.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "다운로드 작업이 없습니다.";
    elements.queueList.replaceChildren(emptyMessage);
    renderActiveProgress();
    persistDownloadQueue();
    return;
  }

  const rows = state.downloadQueue.map((item, index) => createQueueRow(item, index));
  elements.queueList.replaceChildren(...rows);
  renderActiveProgress();
  persistDownloadQueue();
}

function createQueueRow(item: DownloadQueueItem, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = `queue-row ${item.status}`;
  row.classList.toggle("editing", state.editingQueueItemId === item.id);
  row.tabIndex = 0;
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", `${item.title} 편집 상태 복원`);
  row.addEventListener("click", () => restoreQueueItem(item));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      restoreQueueItem(item);
    }
  });

  const header = document.createElement("div");
  header.className = "queue-row-header";

  const title = document.createElement("div");
  title.className = "queue-title";
  title.textContent = `${index + 1}. ${item.title}`;

  const status = document.createElement("span");
  status.className = "queue-status";
  status.textContent = getQueueStatusLabel(item.status);

  const meta = document.createElement("div");
  meta.className = "queue-meta";
  meta.textContent = `${item.completedSegmentKeys.length}/${item.segmentsCount}구간 완료 · ${item.qualityLabel} · ${item.presetName} · ${item.speedLabel}`;

  const track = document.createElement("div");
  track.className = "queue-progress-track";

  const fill = document.createElement("div");
  fill.className = "queue-progress-fill";
  fill.style.width = `${Math.round(clampProgress(item.progress) * 100)}%`;

  const footer = document.createElement("div");
  footer.className = "queue-row-footer";

  const message = document.createElement("div");
  message.className = "queue-message";
  message.textContent = item.message || getQueueStatusLabel(item.status);

  header.append(title, status);
  track.append(fill);
  footer.append(message);

  const outputPath = item.outputPath;
  if (outputPath) {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "queue-open-button";
    openButton.textContent = "열기";
    openButton.addEventListener("click", (event) => {
      event.stopPropagation();
      window.ytClipper.openOutput(outputPath);
    });
    footer.append(openButton);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "queue-open-button";
  removeButton.textContent = "삭제";
  removeButton.disabled = item.status === "running";
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeQueueItem(item.id);
  });
  footer.append(removeButton);

  row.append(header, meta, track, footer);
  return row;
}

function restoreQueueItem(item: DownloadQueueItem): void {
  const link = parseYouTubeLink(item.payload.url);
  if (!link.videoId) {
    setProgressLabel("저장된 큐의 YouTube URL이 유효하지 않습니다.");
    return;
  }

  state.editingQueueItemId = item.id;
  elements.urlInput.value = item.payload.url;
  elements.basenameInput.value = item.payload.basename;
  elements.outputDirInput.value = item.payload.outputDir;
  elements.downloadQualitySelect.value = item.payload.downloadQuality;
  elements.speedLimitSelect.value = item.payload.speedLimit;
  elements.encodingPresetSelect.value = item.payload.encodingPreset;
  renderEncodingPresetDetails();

  const snapshot = item.editorSnapshot || createSnapshotFromQueueItem(item);
  createOrLoadPlayer(link.videoId, null, snapshot);
  switchDownloadView("setup");
  updateDownloadButtonLabel();
  setProgressLabel(`큐 작업 복원됨: ${item.title}`);
  renderDownloadQueue();
}

function removeQueueItem(itemId: string): void {
  const item = state.downloadQueue.find((queueItem) => queueItem.id === itemId);
  if (!item || item.status === "running") {
    return;
  }

  state.downloadQueue = state.downloadQueue.filter(
    (queueItem) => queueItem.id !== itemId
  );
  if (state.editingQueueItemId === itemId) {
    state.editingQueueItemId = null;
    updateDownloadButtonLabel();
  }
  renderDownloadQueue();
  window.ytClipper.releaseDownloadCache(item.id).catch(() => {});
}

function getEditingQueueItem(): DownloadQueueItem | null {
  if (!state.editingQueueItemId) {
    return null;
  }

  return (
    state.downloadQueue.find((item) => item.id === state.editingQueueItemId) ||
    null
  );
}

function normalizeSegmentKey(segment: DownloadSegment): KeyedDownloadSegment {
  return {
    start: Number(segment.start),
    end: Number(segment.end),
    key: segment.key || createSegmentKey(segment.start, segment.end)
  };
}

function createSegmentKey(start: number, end: number): string {
  return `${Number(start).toFixed(3)}-${Number(end).toFixed(3)}`;
}

function getPendingSegments(item: DownloadQueueItem): KeyedDownloadSegment[] {
  const completed = new Set(item.completedSegmentKeys);
  return item.payload.segments
    .map(normalizeSegmentKey)
    .filter((segment) => !completed.has(segment.key));
}

function markSegmentCompleted(
  item: DownloadQueueItem,
  key: string,
  outputPath?: string
): void {
  if (!item.completedSegmentKeys.includes(key)) {
    item.completedSegmentKeys.push(key);
  }

  if (outputPath && !item.outputPaths.includes(outputPath)) {
    item.outputPaths.push(outputPath);
    item.outputPath = outputPath;
  }
  item.progress = getCompletedProgress(item);
}

function getCompletedProgress(item: DownloadQueueItem): number {
  return clampProgress(
    item.completedSegmentKeys.length / Math.max(1, item.payload.segments.length)
  );
}

function captureEditorSnapshot(segments: DownloadSegment[]): EditorSnapshot {
  return {
    startTime: state.startTime,
    endTime: state.endTime,
    rangeIsDefault: state.rangeIsDefault,
    segments: segments.map(normalizeSegmentKey)
  };
}

function createSnapshotFromQueueItem(item: DownloadQueueItem): EditorSnapshot {
  const segments = item.payload.segments.map(normalizeSegmentKey);
  return {
    startTime: segments[0]?.start ?? null,
    endTime: segments[0]?.end ?? null,
    rangeIsDefault: false,
    segments
  };
}

async function initializeDownloadQueue(): Promise<void> {
  try {
    const serialized = await window.ytClipper.loadQueueState();
    restorePersistedDownloadQueue(serialized);
  } catch {
    setProgressLabel("저장된 다운로드 큐를 불러오지 못했습니다.");
  } finally {
    queuePersistenceReady = true;
    renderDownloadQueue();
    runDownloadQueue();
  }
}

function serializeDownloadQueue(): string {
  return JSON.stringify({
    version: 1,
    items: state.downloadQueue,
    editingQueueItemId: state.editingQueueItemId
  });
}

function persistDownloadQueue(): void {
  if (!queuePersistenceReady || queuePersistTimer !== null) {
    return;
  }

  queuePersistTimer = window.setTimeout(() => {
    queuePersistTimer = null;
    window.ytClipper.saveQueueState(serializeDownloadQueue()).catch(() => {});
  }, 150);
}

function flushDownloadQueueState(): void {
  if (!queuePersistenceReady) {
    return;
  }

  if (queuePersistTimer !== null) {
    window.clearTimeout(queuePersistTimer);
    queuePersistTimer = null;
  }
  window.ytClipper.saveQueueStateSync(serializeDownloadQueue());
}

function restorePersistedDownloadQueue(serialized: string | null): void {
  if (!serialized) {
    return;
  }

  try {

    const parsed = JSON.parse(serialized) as {
      items?: unknown[];
      editingQueueItemId?: unknown;
    };
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map(hydrateQueueItem)
          .filter((item): item is DownloadQueueItem => item !== null)
      : [];
    state.downloadQueue = items;

    state.editingQueueItemId = null;
  } catch {
    state.downloadQueue = [];
    state.editingQueueItemId = null;
  }
}

function hydrateQueueItem(value: unknown): DownloadQueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<DownloadQueueItem>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.payload ||
    typeof candidate.payload.url !== "string" ||
    !Array.isArray(candidate.payload.segments)
  ) {
    return null;
  }

  const segments = candidate.payload.segments
    .filter(
      (segment) =>
        Number.isFinite(segment?.start) &&
        Number.isFinite(segment?.end) &&
        segment.end > segment.start
    )
    .map(normalizeSegmentKey);
  if (segments.length === 0) {
    return null;
  }

  const segmentKeys = new Set(segments.map((segment) => segment.key));
  const completedSegmentKeys = Array.isArray(candidate.completedSegmentKeys)
    ? candidate.completedSegmentKeys.filter(
        (key): key is string => typeof key === "string" && segmentKeys.has(key)
      )
    : [];
  const rawStatus = isQueueStatus(candidate.status) ? candidate.status : "queued";
  const status =
    rawStatus === "running" || rawStatus === "error" ? "queued" : rawStatus;
  const snapshotSegments = Array.isArray(candidate.editorSnapshot?.segments)
    ? candidate.editorSnapshot.segments.map(normalizeSegmentKey)
    : segments;

  return {
    id: candidate.id,
    payload: {
      ...candidate.payload,
      segments,
      resumeKey: candidate.id,
      skipSegmentKeys: completedSegmentKeys,
      keepSourceCache: true
    },
    title: candidate.title || candidate.payload.basename || "다운로드 작업",
    segmentsCount: segments.length,
    presetName: candidate.presetName || candidate.payload.encodingPreset,
    qualityLabel: candidate.qualityLabel || candidate.payload.downloadQuality,
    speedLabel: candidate.speedLabel || "제한 없음",
    status:
      completedSegmentKeys.length === segments.length ? "done" : status,
    progress: completedSegmentKeys.length / segments.length,
    message:
      rawStatus === "running" || rawStatus === "error"
        ? "앱 재시작 후 중단 지점부터 재개 대기"
        : candidate.message || "대기 중",
    outputPath: candidate.outputPath || null,
    outputPaths: Array.isArray(candidate.outputPaths)
      ? candidate.outputPaths.filter(
          (outputPath): outputPath is string => typeof outputPath === "string"
        )
      : [],
    error: candidate.error || null,
    jobId: null,
    log: Array.isArray(candidate.log)
      ? candidate.log.filter((line): line is string => typeof line === "string")
      : [],
    completedSegmentKeys,
    currentAttemptKeys: [],
    editorSnapshot: {
      startTime: candidate.editorSnapshot?.startTime ?? segments[0].start,
      endTime: candidate.editorSnapshot?.endTime ?? segments[0].end,
      rangeIsDefault: candidate.editorSnapshot?.rangeIsDefault === true,
      segments: snapshotSegments
    }
  };
}

function isQueueStatus(value: unknown): value is QueueStatus {
  return ["queued", "running", "done", "error"].includes(String(value));
}

function renderActiveProgress(): void {
  const item = getActiveQueueItem() || getLastVisibleQueueItem();

  if (!item) {
    setProgress(0);
    elements.setupStatusLabel.textContent = "대기 중";
    elements.progressLabel.textContent = "대기 중";
    elements.logOutput.textContent = "";
    elements.openOutputButton.classList.add("hidden");
    return;
  }

  setProgress(item.progress);
  elements.setupStatusLabel.textContent = item.message || getQueueStatusLabel(item.status);
  elements.progressLabel.textContent = item.message || getQueueStatusLabel(item.status);
  elements.logOutput.textContent = item.log.join("\n");
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;

  const outputPath = item.outputPath || item.outputPaths?.[0] || null;
  if (outputPath) {
    state.lastOutputPath = outputPath;
    elements.openOutputButton.classList.remove("hidden");
  } else {
    elements.openOutputButton.classList.add("hidden");
  }
}

function getActiveQueueItem(): DownloadQueueItem | null {
  if (!state.activeQueueItemId) {
    return null;
  }

  return state.downloadQueue.find((item) => item.id === state.activeQueueItemId) || null;
}

function getLastVisibleQueueItem(): DownloadQueueItem | null {
  return (
    [...state.downloadQueue]
      .reverse()
      .find((item) => item.status !== "queued") ||
    state.downloadQueue[state.downloadQueue.length - 1] ||
    null
  );
}

function appendQueueLog(item: DownloadQueueItem, line: string): void {
  item.log = [...(item.log || []), line].slice(-QUEUE_LOG_LIMIT);
}

function createQueueItemId(): string {
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedOptionText(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.textContent?.trim() || "";
}

function getQueueStatusLabel(status: QueueStatus): string {
  switch (status) {
    case "queued":
      return "대기";
    case "running":
      return "진행";
    case "done":
      return "완료";
    case "error":
      return "실패";
    default:
      return "대기";
  }
}

function clampProgress(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function setProgress(value: number): void {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  elements.progressFill.style.width = `${percent}%`;
}

function updateDuration(): void {
  const loadedVideoId = state.player?.getVideoData?.().video_id;
  if (
    state.expectedVideoId &&
    loadedVideoId &&
    loadedVideoId !== state.expectedVideoId
  ) {
    return;
  }

  const duration = state.player?.getDuration?.() || 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  if (Math.abs(duration - state.duration) < 0.01) {
    return;
  }

  state.duration = duration;
  elements.durationTime.textContent = formatTime(duration);
  elements.timelineInput.max = String(duration);
  elements.timelineInput.disabled = false;
  if (state.pendingEditorRestore) {
    applyEditorSnapshot(state.pendingEditorRestore);
  } else if (state.pendingLinkRange) {
    applyLinkTimeRange(state.pendingLinkRange);
  } else if (state.rangeIsDefault) {
    applyFullVideoRange();
  } else {
    syncRangeDisplay();
  }
  renderTimeline();
}

function updateVideoMeta(): void {
  const data = state.player?.getVideoData?.();
  const title = data?.title?.trim() || "";

  if (!title || title === state.videoTitle) {
    return;
  }

  state.videoTitle = title;
  elements.videoTitle.textContent = title;
  elements.videoInfo.classList.remove("hidden");
}

function renderTimeline(): void {
  const duration = state.duration;
  const current = getDisplayedTimelineTime();

  elements.currentTime.textContent = formatTime(current);
  elements.timelineInput.value = String(current);

  const currentPercent = getTimelinePercent(current);
  elements.timelineFill.style.width = `${currentPercent}%`;

  renderCurrentAnchor(current);
  renderMarker(elements.startMarkerHandle, state.startTime);
  renderMarker(elements.endMarkerHandle, state.endTime);
  renderMarkerOverlap();
  renderTimelineSegments();
  renderSelectedRange();
}

function renderCurrentAnchor(time: number): void {
  if (state.duration <= 0) {
    elements.currentTimeAnchor.classList.add("hidden");
    return;
  }

  elements.currentTimeAnchor.classList.remove("hidden");
  elements.currentTimeAnchor.classList.toggle("seeking", state.pendingSeekTime !== null);
  elements.currentTimeAnchor.style.left = `${getTimelinePercent(time)}%`;
}

function getDisplayedTimelineTime(): number {
  return clampTime(state.pendingSeekTime ?? state.currentTime);
}

function renderMarker(element: HTMLElement, time: number | null): void {
  if (time === null || state.duration <= 0) {
    element.classList.add("hidden");
    return;
  }

  element.classList.remove("hidden");
  element.style.left = `${getTimelinePercent(time)}%`;
}

function renderMarkerOverlap(): void {
  const overlap =
    state.startTime !== null &&
    state.endTime !== null &&
    state.duration > 0 &&
    (Math.abs(state.endTime - state.startTime) / state.duration) *
      elements.timelineShell.clientWidth <
      16;

  elements.startMarkerHandle.classList.toggle("marker-overlap-start", overlap);
  elements.endMarkerHandle.classList.toggle("marker-overlap-end", overlap);
}

function renderSelectedRange(): void {
  if (
    state.startTime === null ||
    state.endTime === null ||
    state.endTime <= state.startTime ||
    state.duration <= 0
  ) {
    elements.timelineRange.classList.add("hidden");
    return;
  }

  const left = getTimelinePercent(state.startTime);
  const right = getTimelinePercent(state.endTime);
  elements.timelineRange.classList.remove("hidden");
  elements.timelineRange.style.left = `${left}%`;
  elements.timelineRange.style.width = `${right - left}%`;
}

function renderTimelineSegments(): void {
  if (state.duration <= 0 || state.segments.length === 0) {
    elements.timelineSegments.replaceChildren();
    return;
  }

  const ranges = state.segments.map((segment) => {
    const range = document.createElement("div");
    const left = getTimelinePercent(segment.start);
    const right = getTimelinePercent(segment.end);

    range.className = "timeline-segment";
    range.style.left = `${left}%`;
    range.style.width = `${Math.max(0, right - left)}%`;
    return range;
  });

  elements.timelineSegments.replaceChildren(...ranges);
}

function getTimelinePercent(time: number): number {
  if (state.duration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (time / state.duration) * 100));
}

function getCurrentTimelineTime(): number {
  if (state.isScrubbing) {
    return Number(elements.timelineInput.value) || 0;
  }

  if (state.pendingSeekTime !== null) {
    return state.pendingSeekTime;
  }

  const playerTime = state.player?.getCurrentTime?.();
  return typeof playerTime === "number" && Number.isFinite(playerTime)
    ? playerTime
    : state.currentTime || 0;
}

function seekToTimelineTime(time: number, allowSeekAhead: boolean): void {
  if (!state.playerReady || !state.player) {
    return;
  }

  requestTimelineSeek(time, allowSeekAhead, true);
}

function requestTimelineSeek(
  time: number,
  allowSeekAhead: boolean,
  forceSeek: boolean
): void {
  if (!state.playerReady || !state.player) {
    return;
  }

  const next = clampTime(time);
  beginPendingSeek(next);

  const now = performance.now();
  if (forceSeek || now - state.lastTimelineSeekAt >= 80) {
    state.player.seekTo(next, allowSeekAhead);
    state.lastTimelineSeekAt = now;
  }
}

function beginPendingSeek(time: number): void {
  const next = clampTime(time);
  state.pendingSeekTime = next;
  state.pendingSeekStartedAt = performance.now();
  state.currentTime = next;
  renderTimeline();
}

function reconcilePendingSeek(playerTime: number): void {
  if (state.pendingSeekTime === null || !Number.isFinite(playerTime)) {
    return;
  }

  if (Math.abs(playerTime - state.pendingSeekTime) <= SEEK_SETTLE_EPSILON) {
    state.pendingSeekTime = null;
    state.pendingSeekStartedAt = 0;
    state.currentTime = playerTime;
  }
}

function clampTime(time: number): number {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const upper = state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(upper, numeric));
}

function setProgressLabel(message: string): void {
  elements.setupStatusLabel.textContent = message;
  elements.progressLabel.textContent = message;
}

function clearLog(): void {
  elements.logOutput.textContent = "";
}

function appendLog(line: string): void {
  const current = elements.logOutput.textContent;
  const next = `${current}${current ? "\n" : ""}${line}`.split("\n").slice(-120);
  elements.logOutput.textContent = next.join("\n");
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

function parseYouTubeLink(input: string): {
  videoId: string | null;
  timeRange: LinkTimeRange | null;
} {
  try {
    const url = new URL(input.trim());
    return {
      videoId: getYouTubeVideoId(url),
      timeRange: getYouTubeLinkTimeRange(url)
    };
  } catch {
    return { videoId: null, timeRange: null };
  }
}

function extractVideoId(input: string): string | null {
  return parseYouTubeLink(input).videoId;
}

function getYouTubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] || null;
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live"].includes(parts[0])) {
      return parts[1] || null;
    }
  }

  return null;
}

function getYouTubeLinkTimeRange(url: URL): LinkTimeRange | null {
  const paramSets = getUrlParamSets(url);
  const start =
    getFirstTimeParam(paramSets, ["start"]) ??
    getFirstTimeParam(paramSets, ["t"]) ??
    getFirstTimeParam(paramSets, ["time_continue"]);
  const end = getFirstTimeParam(paramSets, ["end"]);

  if (start === null && end === null) {
    return null;
  }

  return {
    start: start ?? 0,
    end
  };
}

function getUrlParamSets(url: URL): URLSearchParams[] {
  const paramSets = [url.searchParams];
  const hash = url.hash.replace(/^#/, "").replace(/^\?/, "");

  if (hash.includes("=")) {
    paramSets.push(new URLSearchParams(hash));
  }

  return paramSets;
}

function getFirstTimeParam(
  paramSets: URLSearchParams[],
  names: string[]
): number | null {
  for (const name of names) {
    for (const params of paramSets) {
      const value = params.get(name);
      const seconds = parseLinkTimeValue(value);
      if (seconds !== null) {
        return seconds;
      }
    }
  }

  return null;
}

function parseLinkTimeValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (/^\d+(?:\.\d+)?s?$/.test(text)) {
    return Number.parseFloat(text);
  }

  if (/^\d{1,2}(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(text)) {
    return text
      .split(":")
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0);
  }

  const unitPattern = /(\d+(?:\.\d+)?)(h|m|s)/g;
  let total = 0;
  let matched = false;
  let match = unitPattern.exec(text);

  while (match) {
    matched = true;
    const amount = Number.parseFloat(match[1]);
    if (match[2] === "h") {
      total += amount * 3600;
    } else if (match[2] === "m") {
      total += amount * 60;
    } else {
      total += amount;
    }

    match = unitPattern.exec(text);
  }

  return matched ? total : null;
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return "00:00.000";
  }

  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${padSeconds(seconds)}`;
  }

  return `${pad(minutes)}:${padSeconds(seconds)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function padSeconds(value: number): string {
  return value.toFixed(3).padStart(6, "0");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
