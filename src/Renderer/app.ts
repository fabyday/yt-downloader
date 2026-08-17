import type {
  DependencyStatus,
  DependencyStatuses,
  AppPreferences,
  DownloadQueueItem,
  DownloadQueueStatus,
  DownloadRequest,
  DownloadSegment,
  EditorSnapshot,
  RendererViewMode
} from "../Shared/types";
import {
  DEFAULT_APP_PREFERENCES,
  normalizeAppPreferences,
} from "../Shared/preferences";
import {
  getLocale,
  initializeI18n,
  LOCALE_CHANGE_EVENT,
  translate as t
} from "./i18n";
import { mountRendererUi, setRendererSelectValue } from "./ui";
import { initializeQueueWindow } from "./queueWindow";
import {
  configureRendererViewActions,
  setDownloadSegmentViewItems,
  setPresetDetails,
  setPresetFormats,
  setQueueViewItems,
  setSegmentViewItems,
  setTimelineRulerViewItems,
  setTimelineSegmentViewItems
} from "./viewStore";

const LOOP_EPSILON = 0.05;
const SEEK_SETTLE_EPSILON = 0.35;
const SEEK_SETTLE_TIMEOUT_MS = 1200;
const MARKER_PLAYHEAD_EPSILON = 0.01;
const TIMELINE_MIN_ZOOM = 1;
const TIMELINE_MAX_ZOOM = 64;
const TIMELINE_ZOOM_STEP = 1.25;
const TIMELINE_MAJOR_TICK_PIXELS = 90;
const SEGMENT_COLOR_PALETTE = [
  [95, 188, 123],
  [88, 196, 221],
  [242, 193, 78],
  [181, 126, 220],
  [228, 87, 46],
  [104, 132, 236],
  [224, 112, 168],
  [82, 190, 170],
] as const;
interface OutputPreset {
  id: string;
  nameKey: string | null;
  fallbackName: string;
  extension: string;
  container: string;
  videoKey: string | null;
  fallbackVideo: string;
  audioKey: string | null;
  fallbackAudio: string;
  targetKey: string;
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
type TimeDragKind = "playback" | MarkerKind;
type TimelineInteraction = "scrub" | "marker" | "readout" | null;

interface PendingPlayerRequest {
  videoId: string;
  initialRange: LinkTimeRange | null;
  editorRestore: EditorSnapshot | null;
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
  timelineViewportStart: number;
  timelineZoom: number;
  downloadQueue: DownloadQueueItem[];
  lastOutputPath: string | null;
  editingQueueItemId: string | null;
  highlightedSegmentId: number | null;
  segmentPulseRevision: number;
  playbackAllowed: boolean;
  preferences: AppPreferences;
}

const OUTPUT_PRESETS: OutputPreset[] = [
  {
    id: "youtube-copy",
    nameKey: "preset.youtubeCopy.name",
    fallbackName: "YouTube source",
    extension: "mkv",
    container: "MKV",
    videoKey: "preset.youtubeCopy.video",
    fallbackVideo: "Source stream copy",
    audioKey: "preset.youtubeCopy.audio",
    fallbackAudio: "Source stream copy",
    targetKey: "preset.youtubeCopy.target"
  },
  {
    id: "h264-mp4",
    nameKey: null,
    fallbackName: "H.264 MP4",
    extension: "mp4",
    container: "MP4",
    videoKey: null,
    fallbackVideo: "H.264 libx264, CRF 18",
    audioKey: null,
    fallbackAudio: "AAC 192k",
    targetKey: "preset.h264.target"
  },
  {
    id: "premiere-prores",
    nameKey: null,
    fallbackName: "Premiere ProRes 422 HQ",
    extension: "mov",
    container: "MOV",
    videoKey: null,
    fallbackVideo: "Apple ProRes 422 HQ 10-bit",
    audioKey: null,
    fallbackAudio: "PCM 16-bit",
    targetKey: "preset.prores.target"
  },
  {
    id: "davinci-dnxhr",
    nameKey: null,
    fallbackName: "DaVinci DNxHR HQX",
    extension: "mov",
    container: "MOV",
    videoKey: null,
    fallbackVideo: "DNxHR HQX 10-bit",
    audioKey: null,
    fallbackAudio: "PCM 16-bit",
    targetKey: "preset.dnxhr.target"
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
  timelineViewportStart: 0,
  timelineZoom: TIMELINE_MIN_ZOOM,
  downloadQueue: [],
  lastOutputPath: null,
  editingQueueItemId: null,
  highlightedSegmentId: null,
  segmentPulseRevision: 0,
  playbackAllowed: false,
  preferences: DEFAULT_APP_PREFERENCES,
};
let dependencyStatuses: DependencyStatuses | null = null;
let timelineRulerSignature = "";
let timelineSegmentsSignature = "";

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function collectElements() {
  return {
  urlInput: getElement<HTMLInputElement>("#urlInput"),
  loadButton: getElement<HTMLButtonElement>("#loadButton"),
  playerStage: getElement<HTMLElement>("#playerStage"),
  player: getElement<HTMLElement>("#player"),
  currentTime: getElement<HTMLElement>("#currentTime"),
  durationTime: getElement<HTMLElement>("#durationTime"),
  timelineRuler: getElement<HTMLButtonElement>("#timelineRuler"),
  timelineRulerPlayhead: getElement<HTMLElement>("#timelineRulerPlayhead"),
  timelineViewportLabel: getElement<HTMLElement>("#timelineViewportLabel"),
  timelineZoomLabel: getElement<HTMLElement>("#timelineZoomLabel"),
  timelineZoomOutButton: getElement<HTMLButtonElement>("#timelineZoomOutButton"),
  timelineZoomResetButton: getElement<HTMLButtonElement>("#timelineZoomResetButton"),
  timelineZoomInButton: getElement<HTMLButtonElement>("#timelineZoomInButton"),
  timelineShell: getElement<HTMLElement>("#timelineShell"),
  timelineInput: getElement<HTMLInputElement>("#timelineInput"),
  timelineFill: getElement<HTMLElement>("#timelineFill"),
  timelineRange: getElement<HTMLElement>("#timelineRange"),
  currentTimeAnchor: getElement<HTMLElement>("#currentTimeAnchor"),
  currentTimeHandle: getElement<HTMLButtonElement>("#currentTimeHandle"),
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
  backLargeButton: getElement<HTMLButtonElement>("#backLargeButton"),
  backSmallButton: getElement<HTMLButtonElement>("#backSmallButton"),
  backFrameButton: getElement<HTMLButtonElement>("#backFrameButton"),
  forwardFrameButton: getElement<HTMLButtonElement>("#forwardFrameButton"),
  forwardSmallButton: getElement<HTMLButtonElement>("#forwardSmallButton"),
  forwardLargeButton: getElement<HTMLButtonElement>("#forwardLargeButton"),
  loopToggle: getElement<HTMLInputElement>("#loopToggle"),
  setupStatusLabel: getElement<HTMLElement>("#setupStatusLabel"),
  basenameInput: getElement<HTMLInputElement>("#basenameInput"),
  outputDirInput: getElement<HTMLInputElement>("#outputDirInput"),
  selectFolderButton: getElement<HTMLButtonElement>("#selectFolderButton"),
  downloadQualitySelect: getElement<HTMLButtonElement>("#downloadQualitySelect"),
  speedLimitSelect: getElement<HTMLButtonElement>("#speedLimitSelect"),
  encodingPresetSelect: getElement<HTMLButtonElement>("#encodingPresetSelect"),
  downloadButton: getElement<HTMLButtonElement>("#downloadButton"),
  ytDlpStatus: getElement<HTMLElement>("#ytDlpStatus"),
  ffmpegStatus: getElement<HTMLElement>("#ffmpegStatus")
  };
}

type RendererElements = ReturnType<typeof collectElements>;
let elements: RendererElements;

async function initializeRenderer(): Promise<void> {
  await initializeI18n();
  const rendererMode = getRendererMode();
  mountRendererUi(rendererMode);
  if (rendererMode === "shell") return;
  if (rendererMode === "queue") {
    await initializeQueueWindow();
    return;
  }
  elements = collectElements();
  try {
    applyPreferences(await window.ytClipper.getPreferences());
  } catch {
    applyPreferences(DEFAULT_APP_PREFERENCES);
  }
  configureRendererViewActions({
    openOutput: (outputPath) => {
      void window.ytClipper
        .openOutput(outputPath)
        .catch(handleRendererRequestError);
    },
    previewSegment: (segmentId) => {
      const segment = state.segments.find((candidate) => candidate.id === segmentId);
      if (segment) {
        loadSegmentToMarkers(segment);
      }
    },
    focusDownloadSegment: (segmentId) => {
      if (segmentId === null) {
        focusCurrentSelection();
        return;
      }
      const segment = state.segments.find((candidate) => candidate.id === segmentId);
      if (segment) loadSegmentToMarkers(segment);
    },
    removeQueueItem: (itemId) => {
      void removeQueueItem(itemId).catch(handleRendererRequestError);
    },
    removeSegment,
    restoreQueueItem: (itemId) => {
      const item = state.downloadQueue.find((candidate) => candidate.id === itemId);
      if (item) {
        restoreQueueItem(item);
      }
    }
  });

  renderEncodingPresetOptions();
  renderEncodingPresetDetails();
  renderSegmentList();
  syncRangeDisplay();
  renderDownloadQueue();
  bindEvents();
  const sourceUrl = new URLSearchParams(window.location.search).get("sourceUrl");
  if (sourceUrl) {
    elements.urlInput.value = sourceUrl;
    loadVideoFromInput();
  }
  void loadDependencies();
  loadYouTubeApi();
  startTicker();
  initializeDownloadQueue();
  window.ytClipper.onPreferencesChanged(applyPreferences);
  window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
}

void initializeRenderer().catch((error) => {
  console.error("Failed to initialize renderer", error);
});

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
  elements.backLargeButton.addEventListener("click", () =>
    seekRelative(-state.preferences.seekLargeSeconds),
  );
  elements.backSmallButton.addEventListener("click", () =>
    seekRelative(-state.preferences.seekSmallSeconds),
  );
  elements.backFrameButton.addEventListener("click", () => seekByFrame(-1));
  elements.forwardFrameButton.addEventListener("click", () => seekByFrame(1));
  elements.forwardSmallButton.addEventListener("click", () =>
    seekRelative(state.preferences.seekSmallSeconds),
  );
  elements.forwardLargeButton.addEventListener("click", () =>
    seekRelative(state.preferences.seekLargeSeconds),
  );
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
  elements.currentTimeHandle.addEventListener("pointerdown", (event) => {
    beginTimelinePositionDrag(event);
  });
  elements.timelineRuler.addEventListener("pointerdown", (event) => {
    beginTimelineRulerDrag(event);
  });
  elements.timelineRuler.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "playback");
  });
  elements.timelineRuler.addEventListener("wheel", handleTimelineWheel, {
    passive: false
  });
  elements.timelineShell.addEventListener("wheel", handleTimelineWheel, {
    passive: false
  });
  elements.timelineZoomOutButton.addEventListener("click", () => {
    zoomTimelineFromControl(1 / TIMELINE_ZOOM_STEP);
  });
  elements.timelineZoomResetButton.addEventListener("click", resetTimelineZoom);
  elements.timelineZoomInButton.addEventListener("click", () => {
    zoomTimelineFromControl(TIMELINE_ZOOM_STEP);
  });
  elements.startMarkerHandle.addEventListener("pointerdown", (event) => {
    beginMarkerDrag(event, "start");
  });
  elements.endMarkerHandle.addEventListener("pointerdown", (event) => {
    beginMarkerDrag(event, "end");
  });
  elements.currentTime.addEventListener("pointerdown", (event) => {
    beginTimeReadoutDrag(event, "playback");
  });
  elements.startTime.addEventListener("pointerdown", (event) => {
    beginTimeReadoutDrag(event, "start");
  });
  elements.endTime.addEventListener("pointerdown", (event) => {
    beginTimeReadoutDrag(event, "end");
  });
  elements.currentTimeHandle.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "playback");
  });
  elements.currentTime.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "playback");
  });
  elements.startTime.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "start");
  });
  elements.endTime.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "end");
  });
  elements.loopToggle.addEventListener("change", () => {
    state.loopEnabled = elements.loopToggle.checked;
  });

  elements.selectFolderButton.addEventListener("click", () => {
    void selectOutputDirectory().catch(handleRendererRequestError);
  });

  elements.downloadButton.addEventListener("click", () => {
    void downloadSection().catch(handleRendererRequestError);
  });
  window.ytClipper.onDownloadQueueChanged(applyDownloadQueueSnapshot);
  window.addEventListener("keydown", handleShortcuts);
}

async function selectOutputDirectory(): Promise<void> {
  const directory = await window.ytClipper.selectOutputDir(getLocale());
  if (directory) {
    elements.outputDirInput.value = directory;
  }
}

function applyPreferences(preferences: AppPreferences): void {
  state.preferences = normalizeAppPreferences(preferences, state.preferences);
  if (!state.editingQueueItemId) {
    elements.outputDirInput.value = state.preferences.defaultOutputDir;
    setRendererSelectValue(
      elements.downloadQualitySelect,
      state.preferences.defaultDownloadQuality,
    );
    setRendererSelectValue(
      elements.speedLimitSelect,
      state.preferences.defaultSpeedLimit,
    );
    setRendererSelectValue(
      elements.encodingPresetSelect,
      state.preferences.defaultEncodingPreset,
    );
    renderEncodingPresetDetails();
  }
  renderPlaybackStepControls();
}

function renderPlaybackStepControls(): void {
  const large = formatSeekStep(state.preferences.seekLargeSeconds);
  const small = formatSeekStep(state.preferences.seekSmallSeconds);
  elements.backLargeButton.textContent = `−${large}`;
  elements.backSmallButton.textContent = `−${small}`;
  elements.forwardSmallButton.textContent = `+${small}`;
  elements.forwardLargeButton.textContent = `+${large}`;
  elements.backLargeButton.title = t("playback.backSeconds", { seconds: large });
  elements.backSmallButton.title = t("playback.backSeconds", { seconds: small });
  elements.forwardSmallButton.title = t("playback.forwardSeconds", {
    seconds: small,
  });
  elements.forwardLargeButton.title = t("playback.forwardSeconds", {
    seconds: large,
  });
  elements.backFrameButton.title = t("playback.backFrameAtRate", {
    frameRate: formatSeekStep(state.preferences.frameRate),
  });
  elements.forwardFrameButton.title = t("playback.forwardFrameAtRate", {
    frameRate: formatSeekStep(state.preferences.frameRate),
  });
}

function formatSeekStep(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function applyDownloadQueueSnapshot(items: DownloadQueueItem[]): void {
  state.downloadQueue = items;
  if (
    state.editingQueueItemId &&
    !items.some((item) => item.id === state.editingQueueItemId)
  ) {
    state.editingQueueItemId = null;
  }
  renderDownloadQueue();
}

function handleLocaleChange(): void {
  renderEncodingPresetOptions();
  renderEncodingPresetDetails();
  renderSegmentList();
  syncRangeDisplay();
  updateDownloadButtonLabel();
  updatePlaybackButton();
  renderDownloadQueue();
  timelineRulerSignature = "";
  renderTimeline();
  renderPlaybackStepControls();

  if (dependencyStatuses) {
    renderDependency(elements.ytDlpStatus, "yt-dlp", dependencyStatuses.ytDlp);
    renderDependency(elements.ffmpegStatus, "ffmpeg", dependencyStatuses.ffmpeg);
  }
}

async function loadDependencies(): Promise<void> {
  dependencyStatuses = await window.ytClipper.getDependencyStatus();
  renderDependency(elements.ytDlpStatus, "yt-dlp", dependencyStatuses.ytDlp);
  renderDependency(elements.ffmpegStatus, "ffmpeg", dependencyStatuses.ffmpeg);
}

function renderDependency(
  element: HTMLElement,
  name: string,
  status: DependencyStatus
): void {
  element.classList.toggle("ready", status.available);
  element.classList.toggle("missing", !status.available);
  const text = status.available
    ? `${name}: ${status.version}`
    : status.reason === "outdated"
      ? t("dependency.outdated", {
          name,
          version: status.version || "?",
          minimum: status.minimumVersion || "?"
        })
      : t("dependency.required", { name });
  const label = element.querySelector<HTMLElement>(".dependency-label");

  if (label) {
    label.textContent = text;
  } else {
    element.textContent = text;
  }

  element.title = text;
}

function renderEncodingPresetOptions(): void {
  setPresetFormats(
    OUTPUT_PRESETS.map((preset) => ({
      id: preset.id,
      name: `${getPresetName(preset)} (.${preset.extension})`,
      meta: `${preset.container} / ${getPresetVideo(preset)} / ${getPresetAudio(preset)}`
    }))
  );
}

function renderEncodingPresetDetails(): void {
  const preset = getSelectedOutputPreset();

  setPresetDetails({
    title: `${getPresetName(preset)} -> .${preset.extension}`,
    meta: `${t(preset.targetKey)} | ${preset.container} / ${getPresetVideo(preset)} / ${getPresetAudio(preset)}`
  });
}

function getPresetName(preset: OutputPreset): string {
  return preset.nameKey ? t(preset.nameKey) : preset.fallbackName;
}

function getPresetVideo(preset: OutputPreset): string {
  return preset.videoKey ? t(preset.videoKey) : preset.fallbackVideo;
}

function getPresetAudio(preset: OutputPreset): string {
  return preset.audioKey ? t(preset.audioKey) : preset.fallbackAudio;
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
    setProgressLabel(t("status.invalidUrl"));
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

  if (state.player?.cueVideoById) {
    state.playerReady = false;
    state.player.cueVideoById(videoId);
    window.setTimeout(() => {
      updateVideoMeta();
      updatePlaybackButton();
    }, 200);
    return;
  }

  if (!window.YT?.Player) {
    state.pendingPlayerRequest = { videoId, initialRange, editorRestore };
    setProgressLabel(t("status.loadingPlayer"));
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
        state.playbackAllowed = false;
        const readyPlayer = state.player;
        if (
          readyPlayer &&
          readyPlayer.getPlayerState() === window.YT?.PlayerState.PLAYING
        ) {
          readyPlayer.pauseVideo();
        }
        updateDuration();
        updateVideoMeta();
        updatePlaybackButton();
        renderTimeline();
        setProgressLabel(t("status.previewReady"));
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
  state.playbackAllowed = false;
  state.highlightedSegmentId = null;
  state.isScrubbing = false;
  state.draggingMarker = null;
  state.timelineInteraction = null;
  state.pendingSeekTime = null;
  state.pendingSeekStartedAt = 0;
  state.timelineViewportStart = 0;
  state.timelineZoom = TIMELINE_MIN_ZOOM;
  timelineRulerSignature = "";
  timelineSegmentsSignature = "";
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

    if (handlePlaybackRangeBoundary(playerTime)) {
      return;
    }

    if (!state.isScrubbing) {
      if (state.pendingSeekTime === null) {
        state.currentTime = playerTime;
      }
      if (state.timelineInteraction === null) {
        ensureTimelineTimeVisible(getDisplayedTimelineTime());
      }
      renderTimeline();
    }
  }, 50);
}

function handlePlaybackRangeBoundary(playerTime: number): boolean {
  const range = getActivePlaybackRange();
  const player = state.player;
  if (
    !range ||
    !player ||
    state.pendingSeekTime !== null ||
    player.getPlayerState() !== window.YT?.PlayerState.PLAYING ||
    playerTime < range.end - LOOP_EPSILON
  ) {
    return false;
  }

  if (state.loopEnabled) {
    requestTimelineSeek(range.start, true, true);
    player.playVideo();
    return true;
  }

  state.playbackAllowed = false;
  player.pauseVideo();
  player.seekTo(range.end, true);
  state.pendingSeekTime = null;
  state.pendingSeekStartedAt = 0;
  state.currentTime = range.end;
  renderTimeline();
  updatePlaybackButton();
  return true;
}

function getActivePlaybackRange(): { start: number; end: number } | null {
  if (
    state.rangeIsDefault ||
    state.startTime === null ||
    state.endTime === null ||
    state.endTime <= state.startTime
  ) {
    return null;
  }

  return { start: state.startTime, end: state.endTime };
}

function setMarker(kind: MarkerKind): void {
  if (!state.playerReady) {
    setProgressLabel(t("status.loadVideoFirst"));
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
    setProgressLabel(t("status.loadVideoFirst"));
    return;
  }

  state.pendingLinkRange = null;
  renderTimeline();
  setProgressLabel(t("status.rangeReset"));
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
    setProgressLabel(t("status.invalidLinkRange"));
    return false;
  }

  state.startTime = start;
  state.endTime = end;
  state.rangeIsDefault =
    start === 0 && Math.abs(state.duration - end) < 0.01;
  syncRangeDisplay();
  updateDownloadButtonLabel();
  renderTimeline();

  if (state.playerReady) {
    seekToTimelineTime(start, true);
  }

  setProgressLabel(
    range.end === null
      ? t("status.linkStartApplied")
      : t("status.linkRangeApplied")
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
  renderDownloadSegmentPlan();

  if (
    state.startTime !== null &&
    state.endTime !== null &&
    state.endTime > state.startTime
  ) {
    const label = state.rangeIsDefault
      ? t("range.fullVideo")
      : t("range.selected");
    elements.rangeSummary.textContent = `${label} · ${formatTime(
      state.endTime - state.startTime
    )}`;
    return;
  }

  elements.rangeSummary.textContent = t("range.unset");
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
  setProgressLabel(
    t("status.segmentListCount", { count: state.segments.length })
  );
}

function clearSegments(): void {
  if (state.segments.length === 0) {
    return;
  }

  state.segments = [];
  renderSegmentList();
  renderTimeline();
  setProgressLabel(t("status.segmentListCleared"));
}

function removeSegment(segmentId: number): void {
  state.segments = state.segments.filter((segment) => segment.id !== segmentId);
  renderSegmentList();
  renderTimeline();
  setProgressLabel(
    t("status.segmentListCount", { count: state.segments.length })
  );
}

function loadSegmentToMarkers(segment: TimelineSegment): void {
  pauseForProgrammaticSeek();
  state.startTime = segment.start;
  state.endTime = segment.end;
  state.rangeIsDefault = false;
  syncRangeDisplay();

  if (state.playerReady) {
    seekToTimelineTime(segment.start, true);
  } else {
    renderTimeline();
  }
  highlightTimelineSegment(segment.id);
}

function focusCurrentSelection(): void {
  if (
    state.startTime === null ||
    state.endTime === null ||
    state.endTime <= state.startTime
  ) {
    return;
  }
  pauseForProgrammaticSeek();
  if (state.playerReady) seekToTimelineTime(state.startTime, true);
  state.highlightedSegmentId = null;
  state.segmentPulseRevision += 1;
  elements.timelineRange.classList.remove("highlighted");
  void elements.timelineRange.offsetWidth;
  elements.timelineRange.classList.add("highlighted");
  renderTimeline();
}

function pauseForProgrammaticSeek(): void {
  state.playbackAllowed = false;
  if (
    state.player &&
    state.player.getPlayerState() === window.YT?.PlayerState.PLAYING
  ) {
    state.player.pauseVideo();
  }
  updatePlaybackButton();
}

function highlightTimelineSegment(segmentId: number): void {
  state.highlightedSegmentId = segmentId;
  state.segmentPulseRevision += 1;
  timelineSegmentsSignature = "";
  renderTimelineSegments();
}

function getSelectionSegment(): DownloadSegment | null {
  if ((state.startTime === null || state.endTime === null) && state.duration > 0) {
    applyFullVideoRange();
  }

  if (state.startTime === null || state.endTime === null) {
    setProgressLabel(t("status.setRangeFirst"));
    return null;
  }

  if (state.endTime <= state.startTime) {
    setProgressLabel(t("status.endAfterStart"));
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
  elements.segmentCount.textContent = t("segments.count", { count });
  elements.clearSegmentsButton.disabled = count === 0;
  elements.segmentList.classList.toggle("empty", count === 0);
  updateDownloadButtonLabel();
  setSegmentViewItems(
    state.segments.map((segment, index) => ({
      color: getSegmentColor(index, 0.78),
      duration: formatTime(segment.end - segment.start),
      id: segment.id,
      title: t("segments.item", { index: index + 1 }),
      times: `${formatTime(segment.start)} - ${formatTime(segment.end)} (${formatTime(segment.end - segment.start)})`
    }))
  );
  renderDownloadSegmentPlan();
}

function renderDownloadSegmentPlan(): void {
  const savedItems = state.segments.map((segment, index) => ({
    color: getSegmentColor(index, 0.78),
    duration: formatTime(segment.end - segment.start),
    id: `segment-${segment.id}`,
    sourceSegmentId: segment.id,
    times: `${formatTime(segment.start)} – ${formatTime(segment.end)}`,
    title: t("segments.item", { index: index + 1 }),
  }));
  const selectionIsValid =
    state.startTime !== null &&
    state.endTime !== null &&
    state.endTime > state.startTime;
  const items =
    savedItems.length > 0 || !selectionIsValid
      ? savedItems
      : [
          {
            color: getSegmentColor(0, 0.78),
            duration: formatTime(state.endTime! - state.startTime!),
            id: "current-selection",
            sourceSegmentId: null,
            times: `${formatTime(state.startTime!)} – ${formatTime(state.endTime!)}`,
            title: state.rangeIsDefault
              ? t("download.fullVideoPlan")
              : t("download.currentSelectionPlan"),
          },
        ];
  setDownloadSegmentViewItems(items, {
    count: items.length,
    duration: formatTime(
      (state.segments.length > 0
        ? state.segments
        : selectionIsValid
          ? [{ start: state.startTime!, end: state.endTime! }]
          : []
      ).reduce((total, segment) => total + segment.end - segment.start, 0),
    ),
  });
}

function updateDownloadButtonLabel(): void {
  const count = state.segments.length;
  if (getEditingQueueItem()) {
    elements.downloadButton.textContent = t("download.updateQueue");
    return;
  }

  if (count === 0 && state.rangeIsDefault && state.startTime !== null && state.endTime !== null) {
    elements.downloadButton.textContent = t("download.addFullVideo");
    return;
  }

  elements.downloadButton.textContent =
    count > 0
      ? t("download.addSegments", { count })
      : t("download.addSelection");
}

function togglePlayback(): void {
  if (!state.playerReady || !state.player) {
    return;
  }

  const playerState = state.player.getPlayerState();
  if (playerState === window.YT?.PlayerState.PLAYING) {
    state.playbackAllowed = false;
    state.player.pauseVideo();
  } else {
    const range = getActivePlaybackRange();
    const current = getCurrentTimelineTime();
    if (
      range &&
      (current < range.start - LOOP_EPSILON ||
        current >= range.end - LOOP_EPSILON)
    ) {
      requestTimelineSeek(range.start, true, true);
    }
    state.playbackAllowed = true;
    state.player.playVideo();
  }
}

function handlePlayerStateChange(): void {
  const videoId = state.player?.getVideoData?.().video_id;
  if (state.expectedVideoId && videoId && videoId !== state.expectedVideoId) {
    return;
  }

  state.playerReady = Boolean(state.player);
  const activePlayer = state.player;
  if (
    activePlayer &&
    activePlayer.getPlayerState() === window.YT?.PlayerState.PLAYING &&
    !state.playbackAllowed
  ) {
    activePlayer.pauseVideo();
    updatePlaybackButton();
    return;
  }
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
  elements.playPauseButton.textContent = playing
    ? t("playback.pause")
    : t("playback.play");
  updateVideoMeta();
}

function seekRelative(delta: number): void {
  if (!state.playerReady) {
    return;
  }

  const next = getCurrentTimelineTime() + delta;
  seekToTimelineTime(next, true);
}

function seekByFrame(direction: -1 | 1): void {
  seekRelative(direction / state.preferences.frameRate);
}

function seekTimelineFromPointer(event: PointerEvent, forceSeek: boolean): void {
  if (!state.playerReady || state.duration <= 0) {
    return;
  }

  seekTimelineFromSurfaceClientX(
    event.clientX,
    elements.timelineInput,
    forceSeek
  );
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

function beginTimelinePositionDrag(event: PointerEvent): void {
  beginTimelineSurfaceDrag(event, elements.timelineInput);
}

function beginTimelineRulerDrag(event: PointerEvent): void {
  beginTimelineSurfaceDrag(event, elements.timelineRuler);
}

function beginTimelineSurfaceDrag(
  event: PointerEvent,
  surface: HTMLElement
): void {
  if (
    event.button !== 0 ||
    !state.playerReady ||
    state.duration <= 0 ||
    state.timelineInteraction !== null
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  state.timelineInteraction = "scrub";
  state.isScrubbing = true;
  const target = event.currentTarget as HTMLElement;
  target.classList.add("dragging");
  capturePointer(target, event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    seekTimelineFromSurfaceClientX(moveEvent.clientX, surface, false);
  };
  const stop = (stopEvent: PointerEvent) => {
    releasePointerCapture(target, stopEvent.pointerId);
    target.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    seekToTimelineTime(getDisplayedTimelineTime(), true);
    state.isScrubbing = false;
    state.timelineInteraction = null;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  seekTimelineFromSurfaceClientX(event.clientX, surface, true);
}

function beginTimeReadoutDrag(event: PointerEvent, kind: TimeDragKind): void {
  if (
    event.button !== 0 ||
    !state.playerReady ||
    state.duration <= 0 ||
    state.timelineInteraction !== null
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const initialClientX = event.clientX;
  const initialTime = getTimeDragValue(kind);
  const dragWidth = Math.max(1, elements.timelineShell.clientWidth);
  const timelineSpan = getTimelineViewport().span;
  state.timelineInteraction = "readout";
  if (kind === "playback") {
    state.isScrubbing = true;
  } else {
    state.draggingMarker = kind;
  }
  target.classList.add("dragging");
  capturePointer(target, event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    const delta = ((moveEvent.clientX - initialClientX) / dragWidth) * timelineSpan;
    applyTimeDragValue(kind, initialTime + delta, false);
  };
  const stop = (stopEvent: PointerEvent) => {
    releasePointerCapture(target, stopEvent.pointerId);
    target.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    applyTimeDragValue(kind, getTimeDragValue(kind), true);
    state.isScrubbing = false;
    state.draggingMarker = null;
    state.timelineInteraction = null;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function handleTimeDragKey(event: KeyboardEvent, kind: TimeDragKind): void {
  if (!state.playerReady || state.duration <= 0) {
    return;
  }

  let next: number | null = null;
  const current = getTimeDragValue(kind);
  const step = event.shiftKey ? 1 : 0.1;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    next = current - step;
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    next = current + step;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = state.duration;
  }

  if (next === null) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  applyTimeDragValue(kind, next, true);
}

function getTimeDragValue(kind: TimeDragKind): number {
  if (kind === "playback") {
    return getDisplayedTimelineTime();
  }
  return kind === "start"
    ? state.startTime ?? getDisplayedTimelineTime()
    : state.endTime ?? getDisplayedTimelineTime();
}

function applyTimeDragValue(
  kind: TimeDragKind,
  time: number,
  forceSeek: boolean
): void {
  if (kind === "playback") {
    requestTimelineSeek(time, true, forceSeek);
    return;
  }
  updateMarkerTime(kind, time, forceSeek);
}

function seekTimelineFromSurfaceClientX(
  clientX: number,
  surface: HTMLElement,
  forceSeek: boolean
): void {
  const rect = surface.getBoundingClientRect();
  requestTimelineSeek(
    getTimelineTimeFromClientX(clientX, rect),
    true,
    forceSeek
  );
}

function handleTimelineWheel(event: WheelEvent): void {
  if (!event.altKey || state.duration <= 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const surface = event.currentTarget as HTMLElement;
  const rect = surface.getBoundingClientRect();
  const anchorRatio = clampRatio(
    rect.width <= 0 ? 0.5 : (event.clientX - rect.left) / rect.width
  );
  zoomTimelineAtRatio(
    event.deltaY < 0 ? TIMELINE_ZOOM_STEP : 1 / TIMELINE_ZOOM_STEP,
    anchorRatio
  );
}

function zoomTimelineFromControl(factor: number): void {
  if (state.duration <= 0) {
    return;
  }

  const viewport = getTimelineViewport();
  const current = getDisplayedTimelineTime();
  const anchorRatio =
    current >= viewport.start && current <= viewport.end
      ? clampRatio((current - viewport.start) / viewport.span)
      : 0.5;
  zoomTimelineAtRatio(factor, anchorRatio);
}

function zoomTimelineAtRatio(factor: number, anchorRatio: number): void {
  const previous = getTimelineViewport();
  const nextZoom = Math.max(
    TIMELINE_MIN_ZOOM,
    Math.min(TIMELINE_MAX_ZOOM, state.timelineZoom * factor)
  );
  if (Math.abs(nextZoom - state.timelineZoom) < 0.0001) {
    return;
  }

  const ratio = clampRatio(anchorRatio);
  const anchorTime = previous.start + previous.span * ratio;
  const nextSpan = state.duration / nextZoom;
  state.timelineZoom = nextZoom;
  state.timelineViewportStart = clampTimelineViewportStart(
    anchorTime - nextSpan * ratio,
    nextSpan
  );
  timelineRulerSignature = "";
  renderTimeline();
}

function resetTimelineZoom(): void {
  if (
    state.timelineZoom === TIMELINE_MIN_ZOOM &&
    state.timelineViewportStart === 0
  ) {
    return;
  }

  state.timelineZoom = TIMELINE_MIN_ZOOM;
  state.timelineViewportStart = 0;
  timelineRulerSignature = "";
  renderTimeline();
}

function getTimelineTimeFromClientX(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">
): number {
  const ratio = clampRatio(
    rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width
  );
  const viewport = getTimelineViewport();
  return clampTime(viewport.start + viewport.span * ratio);
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture can already be gone if the drag is canceled by the OS.
  }
}

function capturePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Synthetic events and an OS-level cancellation may not expose an active pointer.
  }
}

function beginMarkerDrag(event: PointerEvent, marker: MarkerKind): void {
  if (
    event.button !== 0 ||
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
  target.classList.add("dragging");
  capturePointer(target, event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    updateMarkerFromPointer(marker, moveEvent.clientX);
  };

  const stop = (stopEvent: PointerEvent) => {
    releasePointerCapture(target, stopEvent.pointerId);
    target.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    updateMarkerTime(marker, getTimeDragValue(marker), true);
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
  updateMarkerTime(marker, getTimelineTimeFromClientX(clientX, rect), false);
}

function updateMarkerTime(
  marker: MarkerKind,
  time: number,
  forceSeek: boolean
): void {
  const previous = marker === "start" ? state.startTime : state.endTime;
  const playhead = getDisplayedTimelineTime();
  let next = clampTime(time);
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

  if (shouldMovePlayheadWithMarker(marker, previous, next, playhead)) {
    requestTimelineSeek(next, true, forceSeek);
  }
  syncRangeDisplay();
  renderTimeline();
}

function shouldMovePlayheadWithMarker(
  marker: MarkerKind,
  previous: number | null,
  next: number,
  playhead: number
): boolean {
  if (previous === null) {
    return false;
  }

  if (Math.abs(previous - playhead) <= MARKER_PLAYHEAD_EPSILON) {
    return true;
  }

  return marker === "start"
    ? previous < playhead && next >= playhead
    : previous > playhead && next <= playhead;
}

function handleShortcuts(event: KeyboardEvent): void {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
    return;
  }

  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "l") {
    event.preventDefault();
    elements.urlInput.focus();
    elements.urlInput.select();
    return;
  }

  if (command && event.key.toLowerCase() === "t") {
    event.preventDefault();
    void window.ytClipper.createBrowserTab();
    return;
  }

  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.code === "Space") {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, [role='button'], [role='combobox']")
    ) {
      return;
    }
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    seekRelative(event.key === "[" ? -0.1 : 0.1);
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
    if (event.altKey) seekByFrame(-1);
    else
      seekRelative(
        event.shiftKey
          ? -state.preferences.seekLargeSeconds
          : -state.preferences.seekSmallSeconds,
      );
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (event.altKey) seekByFrame(1);
    else
      seekRelative(
        event.shiftKey
          ? state.preferences.seekLargeSeconds
          : state.preferences.seekSmallSeconds,
      );
  }
}

async function downloadSection(): Promise<void> {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) {
    setProgressLabel(t("status.invalidUrl"));
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
    await updateExistingQueueItem(editingItem, segments, basename, preset);
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
    locale: getLocale(),
    resumeKey: itemId,
    skipSegmentKeys: [],
    keepSourceCache: true
  };
  const item: DownloadQueueItem = {
    id: itemId,
    payload,
    title: basename,
    segmentsCount: segments.length,
    presetName: getPresetName(preset),
    qualityLabel: getQualityLabel(elements.downloadQualitySelect.value),
    speedLabel: getSpeedLabel(elements.speedLimitSelect.value),
    status: "queued",
    progress: 0,
    message: t("queue.message.waiting"),
    outputPath: null,
    outputPaths: [],
    error: null,
    jobId: null,
    log: [],
    completedSegmentKeys: [],
    currentAttemptKeys: [],
    editorSnapshot: captureEditorSnapshot(segments)
  };

  state.editingQueueItemId = item.id;
  setProgressLabel(t("status.queueAdded", { title: item.title }));
  applyDownloadQueueSnapshot(await window.ytClipper.enqueueDownload(item));
}

async function updateExistingQueueItem(
  item: DownloadQueueItem,
  selectedSegments: DownloadSegment[],
  basename: string,
  preset: OutputPreset
): Promise<void> {
  const existingSegments = item.payload.segments.map(normalizeSegmentKey);
  const existingKeys = new Set(existingSegments.map((segment) => segment.key));
  const addedSegments = selectedSegments
    .map(normalizeSegmentKey)
    .filter((segment) => !existingKeys.has(segment.key));

  if (addedSegments.length === 0) {
    setProgressLabel(t("status.addNewSegmentFirst"));
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
  item.payload.locale = getLocale();
  item.presetName = getPresetName(preset);
  item.qualityLabel = getQualityLabel(elements.downloadQualitySelect.value);
  item.speedLabel = getSpeedLabel(elements.speedLimitSelect.value);
  item.editorSnapshot = captureEditorSnapshot(mergedSegments);
  item.error = null;

  if (item.status === "running") {
    item.message = t("queue.message.addedRunning", {
      count: addedSegments.length
    });
  } else {
    item.status = "queued";
    item.progress = clampProgress(
      item.completedSegmentKeys.length / Math.max(1, mergedSegments.length)
    );
    item.message = t("queue.message.addedWaiting", {
      count: addedSegments.length
    });
  }

  item.log = [
    ...item.log,
    t("log.segmentAdded", { count: addedSegments.length })
  ].slice(-120);
  state.segments = mergedSegments.map((segment, index) => ({
    ...segment,
    id: index + 1
  }));
  state.nextSegmentId = state.segments.length + 1;
  renderSegmentList();
  renderTimeline();
  applyDownloadQueueSnapshot(await window.ytClipper.updateQueuedDownload(item));
  setProgressLabel(
    t("status.queueSegmentsAdded", { count: addedSegments.length })
  );
}

function renderDownloadQueue(): void {
  setQueueViewItems(
    state.downloadQueue.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      statusLabel: getQueueStatusLabel(item.status),
      editing: state.editingQueueItemId === item.id,
      progress: clampProgress(item.progress),
      meta: t("queue.meta", {
        completed: item.completedSegmentKeys.length,
        total: item.segmentsCount,
        quality: getQualityLabel(item.payload.downloadQuality),
        preset: getPresetNameById(item.payload.encodingPreset),
        speed: getSpeedLabel(item.payload.speedLimit)
      }),
      message: item.message || getQueueStatusLabel(item.status),
      outputPath: item.outputPath,
      canPause: item.status === "queued" || item.status === "running",
      canRemove: true,
      canResume: item.status === "paused" || item.status === "error",
      selected: false
    }))
  );
  renderActiveProgress();
}

function restoreQueueItem(item: DownloadQueueItem): void {
  const link = parseYouTubeLink(item.payload.url);
  if (!link.videoId) {
    setProgressLabel(t("status.invalidSavedUrl"));
    return;
  }

  state.editingQueueItemId = item.id;
  elements.urlInput.value = item.payload.url;
  elements.basenameInput.value = item.payload.basename;
  elements.outputDirInput.value = item.payload.outputDir;
  setRendererSelectValue(
    elements.downloadQualitySelect,
    item.payload.downloadQuality
  );
  setRendererSelectValue(elements.speedLimitSelect, item.payload.speedLimit);
  setRendererSelectValue(
    elements.encodingPresetSelect,
    item.payload.encodingPreset
  );
  renderEncodingPresetDetails();

  const snapshot = item.editorSnapshot || createSnapshotFromQueueItem(item);
  createOrLoadPlayer(link.videoId, null, snapshot);
  updateDownloadButtonLabel();
  setProgressLabel(t("status.queueRestored", { title: item.title }));
  renderDownloadQueue();
}

async function removeQueueItem(itemId: string): Promise<void> {
  const item = state.downloadQueue.find((queueItem) => queueItem.id === itemId);
  if (!item) {
    return;
  }

  if (state.editingQueueItemId === itemId) {
    state.editingQueueItemId = null;
    updateDownloadButtonLabel();
  }
  applyDownloadQueueSnapshot(
    await window.ytClipper.removeQueuedDownload(item.id)
  );
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
    applyDownloadQueueSnapshot(await window.ytClipper.getDownloadQueue());
  } catch {
    setProgressLabel(t("status.queueLoadFailed"));
  }
}

function renderActiveProgress(): void {
  const item = getActiveQueueItem() || getLastVisibleQueueItem();

  if (!item) {
    elements.setupStatusLabel.textContent = t("status.idle");
    return;
  }

  elements.setupStatusLabel.textContent = item.message || getQueueStatusLabel(item.status);

  const outputPath = item.outputPath || item.outputPaths?.[0] || null;
  if (outputPath) {
    state.lastOutputPath = outputPath;
  }
}

function getActiveQueueItem(): DownloadQueueItem | null {
  return state.downloadQueue.find((item) => item.status === "running") || null;
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

function createQueueItemId(): string {
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPresetNameById(presetId: string): string {
  const preset = OUTPUT_PRESETS.find((candidate) => candidate.id === presetId);
  return preset ? getPresetName(preset) : presetId;
}

function getQualityLabel(quality: string): string {
  return quality === "best"
    ? t("quality.best")
    : t("quality.max", { height: quality });
}

function getSpeedLabel(speedLimit: string): string {
  return speedLimit ? `${speedLimit.replace("M", "")} MB/s` : t("speed.unlimited");
}

function getQueueStatusLabel(status: DownloadQueueStatus): string {
  switch (status) {
    case "queued":
      return t("queue.status.queued");
    case "running":
      return t("queue.status.running");
    case "paused":
      return t("queue.status.paused");
    case "done":
      return t("queue.status.done");
    case "error":
      return t("queue.status.error");
    default:
      return t("queue.status.queued");
  }
}

function clampProgress(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
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
    if (state.playerReady) {
      seekToTimelineTime(0, true);
    }
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
  void window.ytClipper.updateBrowserTabTitle(title);
}

function renderTimeline(): void {
  const current = getDisplayedTimelineTime();
  const viewport = getTimelineViewport();

  elements.currentTime.textContent = formatTime(current);
  elements.timelineInput.min = String(viewport.start);
  elements.timelineInput.max = String(viewport.end);
  elements.timelineInput.value = String(current);
  syncTimeHandleAccessibility(elements.currentTime, current);
  syncTimeHandleAccessibility(elements.currentTimeHandle, current);
  syncTimeHandleAccessibility(elements.timelineRuler, current);
  syncTimeHandleAccessibility(
    elements.startTime,
    state.startTime ?? current
  );
  syncTimeHandleAccessibility(
    elements.endTime,
    state.endTime ?? current
  );

  const currentPercent = getTimelinePercent(current);
  elements.timelineFill.style.width = `${currentPercent}%`;

  renderTimelineRuler(viewport);
  renderCurrentAnchor(current);
  renderMarker(elements.startMarkerHandle, state.startTime);
  renderMarker(elements.endMarkerHandle, state.endTime);
  renderMarkerOverlap();
  renderTimelineSegments();
  renderSelectedRange();
}

function syncTimeHandleAccessibility(
  element: HTMLElement,
  time: number
): void {
  const value = clampTime(time);
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", String(Math.max(0, state.duration)));
  element.setAttribute("aria-valuenow", String(value));
  element.setAttribute("aria-valuetext", formatTime(value));
  element.setAttribute(
    "aria-disabled",
    String(!state.playerReady || state.duration <= 0)
  );
}

function renderCurrentAnchor(time: number): void {
  const visible = state.duration > 0 && isTimelineTimeVisible(time);
  elements.timelineRulerPlayhead.classList.toggle("hidden", !visible);
  if (!visible) {
    elements.currentTimeAnchor.classList.add("hidden");
    return;
  }

  const percent = getTimelinePercent(time);
  elements.currentTimeAnchor.classList.remove("hidden");
  elements.currentTimeAnchor.classList.toggle("seeking", state.pendingSeekTime !== null);
  elements.currentTimeAnchor.style.setProperty(
    "--timeline-current-position",
    `${percent}%`
  );
  elements.timelineRuler.style.setProperty(
    "--timeline-current-position",
    `${percent}%`
  );
}

function getDisplayedTimelineTime(): number {
  return clampTime(state.pendingSeekTime ?? state.currentTime);
}

function renderMarker(element: HTMLElement, time: number | null): void {
  if (time === null || state.duration <= 0 || !isTimelineTimeVisible(time)) {
    element.classList.add("hidden");
    return;
  }

  element.classList.remove("hidden");
  const percent = getTimelinePercent(time);
  element.style.left = `${percent}%`;
  element.classList.toggle("marker-edge-start", percent <= 0);
  element.classList.toggle("marker-edge-end", percent >= 100);
}

function renderMarkerOverlap(): void {
  const viewport = getTimelineViewport();
  const overlap =
    state.startTime !== null &&
    state.endTime !== null &&
    isTimelineTimeVisible(state.startTime) &&
    isTimelineTimeVisible(state.endTime) &&
    viewport.span > 0 &&
    (Math.abs(state.endTime - state.startTime) / viewport.span) *
      elements.timelineShell.clientWidth <
      16;

  elements.startMarkerHandle.classList.toggle("marker-overlap-start", overlap);
  elements.endMarkerHandle.classList.toggle("marker-overlap-end", overlap);
}

function renderSelectedRange(): void {
  const viewport = getTimelineViewport();
  if (
    state.startTime === null ||
    state.endTime === null ||
    state.endTime <= state.startTime ||
    state.duration <= 0 ||
    state.endTime < viewport.start ||
    state.startTime > viewport.end
  ) {
    elements.timelineRange.classList.add("hidden");
    return;
  }

  const left = getTimelinePercent(Math.max(state.startTime, viewport.start));
  const right = getTimelinePercent(Math.min(state.endTime, viewport.end));
  elements.timelineRange.classList.remove("hidden");
  elements.timelineRange.style.left = `${left}%`;
  elements.timelineRange.style.width = `${right - left}%`;
}

function renderTimelineSegments(): void {
  if (state.duration <= 0 || state.segments.length === 0) {
    if (timelineSegmentsSignature !== "empty") {
      timelineSegmentsSignature = "empty";
      setTimelineSegmentViewItems([]);
    }
    return;
  }

  const viewport = getTimelineViewport();
  const visibleSegments = state.segments
    .map((segment, index) => ({
      ...segment,
      colorIndex: index,
      visibleStart: Math.max(segment.start, viewport.start),
      visibleEnd: Math.min(segment.end, viewport.end),
    }))
    .filter((segment) => segment.visibleEnd > segment.visibleStart);
  const boundaries = [
    ...new Set(
      visibleSegments.flatMap((segment) => [
        segment.visibleStart,
        segment.visibleEnd,
      ]),
    ),
  ].sort((left, right) => left - right);
  const items = boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1];
    if (end <= start) return [];
    const midpoint = start + (end - start) / 2;
    const active = visibleSegments.filter(
      (segment) => midpoint >= segment.start && midpoint < segment.end,
    );
    if (active.length === 0) return [];
    const left = getTimelinePercent(start);
    const right = getTimelinePercent(end);
    const activeIds = active.map((segment) => segment.id).sort((a, b) => a - b);
    return [
      {
        color: getBlendedSegmentColor(
          active.map((segment) => segment.colorIndex),
        ),
        highlighted:
          state.highlightedSegmentId !== null &&
          activeIds.includes(state.highlightedSegmentId),
        id: `${start.toFixed(4)}-${end.toFixed(4)}-${activeIds.join("-")}`,
        left: `${left}%`,
        pulseRevision: state.segmentPulseRevision,
        width: `${Math.max(0, right - left)}%`,
      },
    ];
  });
  const signature = items
    .map(
      (item) =>
        `${item.id}:${item.left}:${item.width}:${item.color}:${item.highlighted}:${item.pulseRevision}`,
    )
    .join("|");
  if (signature !== timelineSegmentsSignature) {
    timelineSegmentsSignature = signature;
    setTimelineSegmentViewItems(items);
  }
}

function getSegmentColor(index: number, alpha: number): string {
  const [red, green, blue] =
    SEGMENT_COLOR_PALETTE[index % SEGMENT_COLOR_PALETTE.length];
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getBlendedSegmentColor(indices: number[]): string {
  const colors = indices.map(
    (index) => SEGMENT_COLOR_PALETTE[index % SEGMENT_COLOR_PALETTE.length],
  );
  const [red, green, blue] = colors
    .reduce(
      (totals, color) => [
        totals[0] + color[0],
        totals[1] + color[1],
        totals[2] + color[2],
      ],
      [0, 0, 0],
    )
    .map((total) => Math.round(total / colors.length));
  return `rgba(${red}, ${green}, ${blue}, 0.68)`;
}

function getTimelinePercent(time: number): number {
  const viewport = getTimelineViewport();
  if (viewport.span <= 0) {
    return 0;
  }

  return clampRatio((time - viewport.start) / viewport.span) * 100;
}

function getTimelineViewport(): { start: number; end: number; span: number } {
  if (state.duration <= 0) {
    return { start: 0, end: 0, span: 0 };
  }

  const zoom = Math.max(
    TIMELINE_MIN_ZOOM,
    Math.min(TIMELINE_MAX_ZOOM, state.timelineZoom)
  );
  const span = state.duration / zoom;
  const start = clampTimelineViewportStart(state.timelineViewportStart, span);
  state.timelineViewportStart = start;
  return { start, end: Math.min(state.duration, start + span), span };
}

function clampTimelineViewportStart(start: number, span: number): number {
  return Math.max(0, Math.min(Math.max(0, state.duration - span), start));
}

function isTimelineTimeVisible(time: number): boolean {
  const viewport = getTimelineViewport();
  return time >= viewport.start - 0.001 && time <= viewport.end + 0.001;
}

function ensureTimelineTimeVisible(time: number): boolean {
  if (state.duration <= 0 || state.timelineZoom <= TIMELINE_MIN_ZOOM) {
    return false;
  }

  const viewport = getTimelineViewport();
  if (time >= viewport.start && time <= viewport.end) {
    return false;
  }

  state.timelineViewportStart = clampTimelineViewportStart(
    time - viewport.span * 0.08,
    viewport.span
  );
  timelineRulerSignature = "";
  timelineSegmentsSignature = "";
  return true;
}

function renderTimelineRuler(viewport: {
  start: number;
  end: number;
  span: number;
}): void {
  const zoom = state.timelineZoom;
  elements.timelineRuler.disabled = state.duration <= 0;
  elements.timelineViewportLabel.textContent = `${formatTime(viewport.start)} – ${formatTime(viewport.end)}`;
  elements.timelineZoomLabel.textContent = `${formatZoom(zoom)}×`;
  elements.timelineZoomOutButton.disabled = zoom <= TIMELINE_MIN_ZOOM + 0.0001;
  elements.timelineZoomInButton.disabled = zoom >= TIMELINE_MAX_ZOOM - 0.0001;
  elements.timelineZoomResetButton.disabled = zoom <= TIMELINE_MIN_ZOOM + 0.0001;

  if (state.duration <= 0 || viewport.span <= 0) {
    if (timelineRulerSignature !== "empty") {
      timelineRulerSignature = "empty";
      setTimelineRulerViewItems([]);
    }
    return;
  }

  const width = Math.max(1, elements.timelineRuler.clientWidth);
  const majorInterval = getTimelineMajorInterval(viewport.span, width);
  const minorInterval = majorInterval / 5;
  const signature = [
    viewport.start.toFixed(4),
    viewport.end.toFixed(4),
    Math.round(width),
    majorInterval
  ].join(":");
  if (signature === timelineRulerSignature) {
    return;
  }

  timelineRulerSignature = signature;
  const firstTick = Math.ceil((viewport.start - 0.000001) / minorInterval) * minorInterval;
  const items: Array<{
    id: string;
    label: string | null;
    left: string;
    major: boolean;
  }> = [];
  for (
    let index = 0, time = firstTick;
    time <= viewport.end + minorInterval * 0.01 && index < 240;
    index += 1, time += minorInterval
  ) {
    const major =
      Math.abs(time / majorInterval - Math.round(time / majorInterval)) <
      0.0001;
    items.push({
      id: `${index}-${time.toFixed(6)}`,
      label: major ? formatTimelineRulerTime(time, majorInterval) : null,
      left: `${getTimelinePercent(time)}%`,
      major
    });
  }
  setTimelineRulerViewItems(items);
}

function getTimelineMajorInterval(span: number, width: number): number {
  const target = span / Math.max(1, width / TIMELINE_MAJOR_TICK_PIXELS);
  const intervals = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
    60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400
  ];
  return intervals.find((interval) => interval >= target) ?? intervals[intervals.length - 1];
}

function formatTimelineRulerTime(time: number, interval: number): string {
  if (interval < 1) {
    const tenths = Math.round(Math.max(0, time) * 10);
    const wholeSeconds = Math.floor(tenths / 10);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;
    const prefix = hours > 0 ? `${pad(hours)}:${pad(minutes)}` : pad(minutes);
    return `${prefix}:${pad(seconds)}.${tenths % 10}`;
  }

  const rounded = Math.round(Math.max(0, time));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatZoom(zoom: number): string {
  return zoom >= 10
    ? String(Math.round(zoom))
    : zoom.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
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
  ensureTimelineTimeVisible(next);
  renderTimeline();
}

function reconcilePendingSeek(playerTime: number): void {
  if (state.pendingSeekTime === null || !Number.isFinite(playerTime)) {
    return;
  }

  const settled =
    Math.abs(playerTime - state.pendingSeekTime) <= SEEK_SETTLE_EPSILON;
  const timedOut =
    performance.now() - state.pendingSeekStartedAt >= SEEK_SETTLE_TIMEOUT_MS;
  if (settled || timedOut) {
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
  elements.setupStatusLabel.title = message;
}

function getRendererMode(): RendererViewMode {
  const value = new URLSearchParams(window.location.search).get("view");
  return value === "shell" || value === "queue" ? value : "editor";
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

function handleRendererRequestError(error: unknown): void {
  const message = getErrorMessage(error);
  console.error("Renderer request failed", error);
  setProgressLabel(message);
}
