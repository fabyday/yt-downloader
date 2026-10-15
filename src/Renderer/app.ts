import { buildTimelineTicks } from "./TimelineScale";
import { nearestTimelineHandle, zoomViewportStart, type TimelineHandle, type ZoomPivot } from "../Shared/timelineInteraction";
import { setPlaybackOptionsView } from "./viewStore";
import type {
  DependencyStatus,
  DependencyStatuses,
  AppPreferences,
  DownloadQueueItem,
  DownloadQueueStatus,
  DownloadRequest,
  DownloadSegment,
  EditorSnapshot,
  PreviewResult,
  RendererViewMode
} from "../Shared/types";
import { parseVideoSource, isChzzkLiveUrl } from "../Shared/VideoSource";
import { movePlayhead, type SelectionMode } from "../Shared/selectionMode";
import { editMarker, sameSegment, type MarkerEdit } from "../Shared/markerRules";
import { EXTRA_PRESETS, DEFAULT_CUSTOM_ARGS, customEncodingPreset } from "../Shared/encoding";
import { NativePreview } from "./NativePreview";
import { SHORTCUT_ACTIONS, shortcutFromEvent, platformShortcut } from "../Shared/shortcuts";
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
  setPreviewMessage,
  setSelectionModeView,
  setQueueViewItems,
  setSegmentViewItems,
  showSegmentNotice,
  setTimelineRulerViewItems,
  setTimelineSegmentViewItems
} from "./viewStore";

const LOOP_EPSILON = 0.05;
// Playback state used by the common media adapter.
const PLAYER_PLAYING = 1;
const SEEK_SETTLE_EPSILON = 0.35;
const MARKER_PLAYHEAD_EPSILON = 0.01;
const TIMELINE_MIN_ZOOM = 1;
const TIMELINE_MAX_ZOOM = 64;
const TIMELINE_ZOOM_STEP = 1.25;
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

interface RendererState {
  selectionMode: SelectionMode;
  player: PreviewPlayer | null;
  playerReady: boolean;
  currentTime: number;
  duration: number;
  videoTitle: string;
  startTime: number | null;
  endTime: number | null;
  rangeIsDefault: boolean;
  pendingLinkRange: LinkTimeRange | null;
  pendingEditorRestore: EditorSnapshot | null;
  expectedVideoId: string | null;
  segments: TimelineSegment[];
  nextSegmentId: number;
  loopEnabled: boolean;
  isScrubbing: boolean;
  draggingMarker: MarkerKind | null;
  markerAttachedPlayhead: MarkerKind | null;
  timelineInteraction: TimelineInteraction;
  pendingSeekTime: number | null;
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
  ...EXTRA_PRESETS.map(preset => ({ id: preset.id, nameKey: null, fallbackName: preset.name,
    extension: preset.extension, container: preset.extension.toUpperCase(), videoKey: null,
    fallbackVideo: preset.args.join(" "), audioKey: null, fallbackAudio: "", targetKey: "encoding.output" })),
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
  selectionMode: "free",
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
  expectedVideoId: null,
  segments: [],
  nextSegmentId: 1,
  loopEnabled: false,
  isScrubbing: false,
  draggingMarker: null,
  markerAttachedPlayhead: null,
  timelineInteraction: null,
  pendingSeekTime: null,
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
  timelineViewportLabel: getElement<HTMLElement>("#timelineViewportLabel"),
  timelineZoomLabel: getElement<HTMLElement>("#timelineZoomLabel"),
  timelineZoomOutButton: getElement<HTMLButtonElement>("#timelineZoomOutButton"),
  timelineZoomResetButton: getElement<HTMLButtonElement>("#timelineZoomResetButton"),
  timelineZoomInButton: getElement<HTMLButtonElement>("#timelineZoomInButton"),
  timelineSurface: getElement<HTMLElement>(".timeline-surface"),
  timelineShell: getElement<HTMLElement>("#timelineShell"),
  timelineInteractionArea: getElement<HTMLElement>("#timelineInteractionArea"),
  timelineInput: getElement<HTMLInputElement>("#timelineInput"),
  timelineFill: getElement<HTMLElement>("#timelineFill"),
  timelineRange: getElement<HTMLElement>("#timelineRange"),
  currentTimeAnchor: getElement<HTMLElement>("#currentTimeAnchor"),
  currentTimeHandle: getElement<HTMLButtonElement>("#currentTimeHandle"),
  startMarkerHandle: getElement<HTMLButtonElement>("#startMarkerHandle"),
  endMarkerHandle: getElement<HTMLButtonElement>("#endMarkerHandle"),
  markerSplitTags: getElement<HTMLElement>("#markerSplitTags"),
  splitStartMarker: getElement<HTMLButtonElement>("#splitStartMarker"),
  splitEndMarker: getElement<HTMLButtonElement>("#splitEndMarker"),
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
    setVolume: changeVolume,
    toggleMute: () => updatePlaybackPreferences({ previewMuted: !state.preferences.previewMuted }),
    setVolumeOpen,
    setZoomPivot: (timelineZoomPivot) => updatePlaybackPreferences({ timelineZoomPivot }),
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
  new ResizeObserver(() => renderTimeline()).observe(elements.timelineRuler);
  startTicker();
  initializeDownloadQueue();
  window.ytClipper.onPreferencesChanged(applyPreferences);
  window.ytClipper.onCookiesChanged?.(() => {
    previewSources.clear();
    const videoId = state.expectedVideoId;
    if (!videoId) return;
    const snapshot = captureEditorSnapshot(state.segments);
    // Resolve a fresh stream with the updated cookie snapshot, preserving edits.
    state.player?.destroy();
    state.player = null;
    state.playerReady = false;
    createOrLoadPlayer(videoId, null, snapshot);
  });
  window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
}

void initializeRenderer().catch((error) => {
  console.error("Failed to initialize renderer", error);
});

function bindEvents() {
  for (const mode of ["clamp", "follow", "free"] as const) {
    document.getElementById(`selectionMode-${mode}`)?.addEventListener("click", () => changeSelectionMode(mode));
  }
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
  document.getElementById("encodingModeSelect")?.addEventListener("change", renderEncodingPresetDetails);
  document.getElementById("customExtensionSelect")?.addEventListener("change", renderEncodingPresetDetails);
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
  elements.timelineInput.addEventListener("pointerdown", beginTimelineAreaDrag);
  elements.timelineInteractionArea.addEventListener("pointerdown", beginTimelineAreaDrag);
  elements.timelineInteractionArea.addEventListener("pointermove", event => {
    if (state.timelineInteraction !== null) return;
    elements.timelineInteractionArea.dataset.hoverHandle = timelineHandleAt(event.clientX) ?? "";
  });
  elements.timelineInteractionArea.addEventListener("pointerleave", () => {
    delete elements.timelineInteractionArea.dataset.hoverHandle;
  });
  elements.timelineInput.addEventListener("input", scrubTimeline);
  elements.currentTimeHandle.addEventListener("pointerdown", (event) => {
    beginTimelinePositionDrag(event);
  });
  elements.timelineRuler.addEventListener("pointerdown", (event) => {
    beginTimelineRulerDrag(event);
  });
  elements.timelineRuler.addEventListener("keydown", (event) => {
    handleTimeDragKey(event, "playback");
  });
  elements.timelineSurface.addEventListener("wheel", handleTimelineWheel, {
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
  for (const [tag, kind] of [[elements.splitStartMarker, "start"], [elements.splitEndMarker, "end"]] as const) {
    tag.addEventListener("pointerdown", event => beginMarkerDrag(event, kind, true));
    tag.addEventListener("keydown", event => handleTimeDragKey(event, kind));
  }
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
  // App bindings take precedence over focused buttons/sliders and their native
  // activation. Text editing, menus and modal shortcut recording remain scoped.
  window.addEventListener("keydown", (event) => updateTimelineZoomHint(event.altKey), true);
  window.addEventListener("keyup", (event) => updateTimelineZoomHint(event.altKey), true);
  // Recover the modifier state if Alt was pressed/released in another window.
  window.addEventListener("pointermove", (event) => updateTimelineZoomHint(event.altKey), { passive: true });
  window.addEventListener("keydown", handleShortcuts, true);
  window.addEventListener("keyup", (event) => {
    if (!consumedShortcutKeys.delete(event.code || event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("blur", () => {
    consumedShortcutKeys.clear();
    updateTimelineZoomHint(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) updateTimelineZoomHint(false);
  });
}

async function selectOutputDirectory(): Promise<void> {
  const directory = await window.ytClipper.selectOutputDir(getLocale());
  if (directory) {
    elements.outputDirInput.value = directory;
  }
}

function applyPreferences(preferences: AppPreferences): void {
  const previous = state.preferences;
  state.preferences = normalizeAppPreferences({ ...preferences, ...pendingPlaybackPreferences }, previous);
  syncPlaybackOptions();
  if (!state.editingQueueItemId && (!preferencesApplied ||
    previous.defaultOutputDir !== state.preferences.defaultOutputDir ||
    previous.defaultDownloadQuality !== state.preferences.defaultDownloadQuality ||
    previous.defaultSpeedLimit !== state.preferences.defaultSpeedLimit ||
    previous.defaultEncodingPreset !== state.preferences.defaultEncodingPreset)) {
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
  preferencesApplied = true;
}

type PlaybackPreferences = Pick<AppPreferences, "previewVolume" | "previewMuted" | "timelineZoomPivot">;
let pendingPlaybackPreferences: Partial<PlaybackPreferences> = {};
let playbackSaveTimer: number | undefined;
let savingPlaybackPreferences = false;
let preferencesApplied = false;
let volumeOpen = false;

function syncPlaybackOptions(): void {
  state.player?.setVolume(state.preferences.previewVolume, state.preferences.previewMuted);
  setPlaybackOptionsView({ volume: state.preferences.previewVolume, muted: state.preferences.previewMuted,
    zoomPivot: state.preferences.timelineZoomPivot });
}

function setVolumeOpen(open: boolean): void {
  if (!open && document.activeElement?.closest(".volume-popover")) document.getElementById("volumeButton")?.focus();
  volumeOpen = open;
  setPlaybackOptionsView({ volumeOpen });
}

function changeVolume(volume: number): void {
  updatePlaybackPreferences({ previewVolume: Math.round(Math.max(0, Math.min(1, volume)) * 100) / 100, previewMuted: false });
}

function updatePlaybackPreferences(patch: Partial<PlaybackPreferences>): void {
  Object.assign(pendingPlaybackPreferences, patch);
  Object.assign(state.preferences, patch);
  syncPlaybackOptions();
  window.clearTimeout(playbackSaveTimer);
  playbackSaveTimer = window.setTimeout(() => void savePlaybackPreferences(), 200);
}

async function savePlaybackPreferences(): Promise<void> {
  if (savingPlaybackPreferences || !Object.keys(pendingPlaybackPreferences).length) return;
  savingPlaybackPreferences = true;
  const patch = { ...pendingPlaybackPreferences };
  try {
    await window.ytClipper.updatePreferences(patch);
    for (const key of Object.keys(patch) as (keyof PlaybackPreferences)[]) {
      if (pendingPlaybackPreferences[key] === patch[key]) delete pendingPlaybackPreferences[key];
    }
  } catch (error) {
    handleRendererRequestError(error);
    return;
  } finally { savingPlaybackPreferences = false; }
  if (Object.keys(pendingPlaybackPreferences).length) void savePlaybackPreferences();
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
    ? `${name}: ${name === "ffmpeg" ? (status.version ?? "?").replace(/^ffmpeg version\s+/i, "").split(/\s+(?:Copyright|https?:\/\/|www\.)/)[0].trim() : status.version}`
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

  element.title = status.available ? `${name}: ${status.version}` : text;
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

function getEncodingRequestOptions(): Pick<DownloadRequest, "encodingPreset" | "customFfmpegArgs" | "customExtension"> {
  const preset = getSelectedOutputPreset();
  return preset.id === "custom" ? { encodingPreset: "custom", customExtension: preset.extension,
    customFfmpegArgs: (document.getElementById("customFfmpegArgs") as HTMLTextAreaElement).value }
    : { encodingPreset: preset.id };
}

function renderEncodingPresetDetails(): void {
  const preset = getSelectedOutputPreset();

  setPresetDetails({
    title: `${getPresetName(preset)} -> .${preset.extension}`,
    meta: preset.id === "custom" ? `${preset.extension.toUpperCase()} · ${t("encoding.options")}` :
      `${t(preset.targetKey)} | ${[preset.container, getPresetVideo(preset), getPresetAudio(preset)].filter(Boolean).join(" / ")}`
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
  if ((document.getElementById("encodingModeSelect") as HTMLButtonElement)?.value === "custom") {
    return { id: "custom", nameKey: "encoding.custom", fallbackName: "Custom FFmpeg",
      extension: (document.getElementById("customExtensionSelect") as HTMLButtonElement).value,
      container: "FFmpeg", videoKey: null, fallbackVideo: "", audioKey: null, fallbackAudio: "", targetKey: "encoding.help" };
  }
  return (
    OUTPUT_PRESETS.find((preset) => preset.id === elements.encodingPresetSelect.value) ||
    OUTPUT_PRESETS.find(preset => preset.id === "youtube-copy")!
  );
}

function loadVideoFromInput(): void {
  if (elements.loadButton.disabled) return;
  const link = parseSourceLink(elements.urlInput.value);
  const videoId = link.videoId;
  if (!videoId) {
    setProgressLabel(t(isChzzkLiveUrl(elements.urlInput.value) ? "preview.liveUnsupported" : "status.invalidUrl"));
    return;
  }

  state.editingQueueItemId = null;
  createOrLoadPlayer(videoId, link.timeRange);
  updateDownloadButtonLabel();
  if (!elements.basenameInput.value.trim()) {
    elements.basenameInput.value = videoId.startsWith("web:") ? `clip-${parseVideoSource(elements.urlInput.value)?.id ?? "video"}-${Date.now()}` : `clip-${videoId.replace(":", "-")}`;
  }
}

let previewGeneration = 0;
let loadedPreviewGeneration = -1;
const previewSources = new Map<string, { result: Extract<PreviewResult, { ok: true }>; expires: number }>();

function ensurePlayerPlaceholder(): void {
  if (document.getElementById("player")) return;
  const placeholder = document.createElement("div");
  placeholder.id = "player";
  elements.playerStage.querySelector(".player-viewport")?.prepend(placeholder);
}

async function loadNativePreview(videoId: string, generation: number): Promise<void> {
  if (generation !== previewGeneration || loadedPreviewGeneration === generation) return;
  loadedPreviewGeneration = generation;
  void window.ytClipper.updateBrowserTabTitle("", videoId);
  state.playerReady = false;
  state.playbackAllowed = false;
  // Stop the previous source while the replacement is being resolved.
  state.player?.pauseVideo();
  state.player?.destroy();
  state.player = null;
  ensurePlayerPlaceholder();
  setPreviewMessage("preview.checking");
  try {
    const cached = previewSources.get(videoId);
    const result = cached && cached.expires > Date.now() ? cached.result : await window.ytClipper.resolvePreview(videoId);
    if (generation !== previewGeneration) return;
    // Metadata is useful even when Chromium cannot play the extracted codec/transport.
    if (result.duration) updateDuration(result.duration);
    if (result.title) updateVideoMeta(result.title);
    if (!result.ok) { setPreviewMessage(result.error); setProgressLabel(t(result.error)); return; }
    if (!cached || cached.expires <= Date.now()) {
      if (previewSources.size >= 8) previewSources.delete(previewSources.keys().next().value!);
      previewSources.set(videoId, { result, expires: Date.now() + 60_000 });
    }
    ensurePlayerPlaceholder();
    state.player = new NativePreview(result, () => {
      if (generation !== previewGeneration) return;
      state.playerReady = true;
      state.playbackAllowed = false;
      setPreviewMessage(null);
      updateDuration();
      updateVideoMeta();
      seekToTimelineTime(state.startTime ?? 0, true);
      updatePlaybackButton();
      renderTimeline();
      setProgressLabel(t("status.previewReady"));
    }, handlePlayerStateChange, () => {
      if (generation !== previewGeneration) return;
      previewSources.delete(videoId);
      state.playerReady = false;
      setPreviewMessage("preview.streamFailed");
      setProgressLabel(t("preview.streamFailed"));
    });
    syncPlaybackOptions();
    setPreviewMessage("preview.loading");
  } catch {
    if (generation === previewGeneration) setPreviewMessage("preview.failed");
  }
}

function createOrLoadPlayer(
  videoId: string,
  initialRange: LinkTimeRange | null = null,
  editorRestore: EditorSnapshot | null = null
): void {
  const generation = ++previewGeneration;
  setPreviewMessage(null);
  resetMarkers();
  state.pendingLinkRange = initialRange;
  state.pendingEditorRestore = editorRestore;
  state.expectedVideoId = videoId;
  elements.playerStage.classList.add("has-video");

  if (state.player) {
    state.player.destroy();
    state.player = null;
  }
  ensurePlayerPlaceholder();
  state.playerReady = false;
  void loadNativePreview(videoId, generation);
}

function resetMarkers(): void {
  lastTimelineHandle = null;
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
  state.markerAttachedPlayhead = null;
  state.timelineInteraction = null;
  state.pendingSeekTime = null;
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
      if (state.timelineInteraction === null && state.preferences.timelineZoomPivot === "playhead" && state.player.getPlayerState() === PLAYER_PLAYING) {
        ensureTimelineTimeVisible(getDisplayedTimelineTime());
      }
      renderTimeline();
    }
  }, 50);
}

function handlePlaybackRangeBoundary(playerTime: number): boolean {
  const range = getActivePlaybackRange();
  const player = state.player;
  if (state.selectionMode === "follow" && state.pendingSeekTime === null && player?.getPlayerState() === PLAYER_PLAYING) {
    constrainPlayhead(playerTime);
  }
  if (
    !range ||
    !player ||
    state.pendingSeekTime !== null ||
    player.getPlayerState() !== PLAYER_PLAYING ||
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
  state.currentTime = range.end;
  renderTimeline();
  updatePlaybackButton();
  return true;
}

function getActivePlaybackRange(): { start: number; end: number } | null {
  if (
    state.selectionMode !== "clamp" ||
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
  const range = editMarker(kind, current, state.duration, state.startTime, state.endTime, "place");
  state.startTime = range.start;
  state.endTime = range.end;

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
  const end = state.duration;

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

  setProgressLabel(t("status.linkStartApplied"));
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
    .filter((segment) => segment.end > segment.start)
    .filter((segment, index, all) => !all.slice(0, index).some(previous => sameSegment(previous, segment)));

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
    state.endTime < state.startTime
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
    state.endTime >= state.startTime
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
  if (state.segments.some(existing => sameSegment(existing, segment))) {
    showSegmentNotice("segments.duplicate");
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
    state.player.getPlayerState() === PLAYER_PLAYING
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
    showSegmentNotice("status.endAfterStart");
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
  if (playerState === PLAYER_PLAYING) {
    state.playbackAllowed = false;
    state.player.pauseVideo();
  } else {
    const range = getActivePlaybackRange();
    const current = getCurrentTimelineTime();
    if (
      range &&
      (current < range.start - LOOP_EPSILON ||
        (state.loopEnabled && current >= range.end - LOOP_EPSILON))
    ) {
      requestTimelineSeek(range.start, true, true);
    }
    if (range && !state.loopEnabled && current >= range.end - LOOP_EPSILON) return;
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
    activePlayer.getPlayerState() === PLAYER_PLAYING &&
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
  const playing = playerState === PLAYER_PLAYING;
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

function beginTimelinePositionDrag(event: PointerEvent): void {
  lastTimelineHandle = "playhead";
  beginTimelineSurfaceDrag(event, elements.timelineInput, true);
}

let lastTimelineHandle: TimelineHandle | null = null;

function timelineHandleAt(clientX: number): TimelineHandle | null {
  if (!state.playerReady || state.duration <= 0) return null;
  const rect = elements.timelineInput.getBoundingClientRect();
  const candidates: { kind: TimelineHandle; x: number }[] = [];
  for (const [kind, time] of [["start", state.startTime], ["end", state.endTime], ["playhead", getDisplayedTimelineTime()]] as const) {
    if (time !== null && isTimelineTimeVisible(time)) candidates.push({ kind, x: rect.left + rect.width * getTimelinePercent(time) / 100 });
  }
  return nearestTimelineHandle(clientX, candidates, lastTimelineHandle);
}

function beginTimelineAreaDrag(event: PointerEvent): void {
  const handle = timelineHandleAt(event.clientX);
  if (handle === "start" || handle === "end") beginMarkerDrag(event, handle, true);
  else {
    lastTimelineHandle = "playhead";
    beginTimelineSurfaceDrag(event, elements.timelineInput, handle === "playhead");
  }
}

function beginTimelineRulerDrag(event: PointerEvent): void {
  beginTimelineSurfaceDrag(event, elements.timelineRuler);
}

function beginTimelineSurfaceDrag(
  event: PointerEvent,
  surface: HTMLElement,
  relative = false,
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

  const rect = surface.getBoundingClientRect();
  const offset = relative ? event.clientX - (rect.left + rect.width * getTimelinePercent(getDisplayedTimelineTime()) / 100) : 0;

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    seekTimelineFromSurfaceClientX(moveEvent.clientX - offset, surface, false);
  };
  const stop = (stopEvent: PointerEvent) => {
    if (stopEvent.pointerId !== event.pointerId) return;
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
  seekTimelineFromSurfaceClientX(event.clientX - offset, surface, true);
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
  const dragWidth = Math.max(1, elements.timelineInput.getBoundingClientRect().width);
  const timelineSpan = getTimelineViewport().span;
  state.timelineInteraction = "readout";
  state.markerAttachedPlayhead = null;
  if (kind === "playback") {
    state.isScrubbing = true;
  } else {
    state.draggingMarker = kind;
  }
  target.classList.add("dragging");
  capturePointer(target, event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    const delta = ((moveEvent.clientX - initialClientX) / dragWidth) * timelineSpan;
    applyTimeDragValue(kind, initialTime + delta, false);
  };
  const stop = (stopEvent: PointerEvent) => {
    if (stopEvent.pointerId !== event.pointerId) return;
    releasePointerCapture(target, stopEvent.pointerId);
    target.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    applyTimeDragValue(kind, getTimeDragValue(kind), true);
    state.markerAttachedPlayhead = null;
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
  if (kind === "playback") applyTimeDragValue(kind, next, true);
  else updateMarkerTime(kind, next, true, "place");
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

function updateTimelineZoomHint(altPressed: boolean): void {
  const active = altPressed && state.duration > 0 &&
    !document.querySelector('[role="dialog"][aria-modal="true"]');
  elements.timelineShell.closest(".timeline-panel")?.classList.toggle("alt-zoom-active", active);
}

function handleTimelineWheel(event: WheelEvent): void {
  updateTimelineZoomHint(event.altKey);
  if (!event.altKey || state.duration <= 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  zoomTimelineFromControl(event.deltaY < 0 ? TIMELINE_ZOOM_STEP : 1 / TIMELINE_ZOOM_STEP);
}

function zoomTimelineFromControl(factor: number): void {
  if (state.duration <= 0) {
    return;
  }

  if (state.timelineInteraction !== null) return;
  const previous = getTimelineViewport();
  const nextZoom = Math.max(
    TIMELINE_MIN_ZOOM,
    Math.min(TIMELINE_MAX_ZOOM, state.timelineZoom * factor)
  );
  if (Math.abs(nextZoom - state.timelineZoom) < 0.0001) {
    return;
  }

  const pivot = state.preferences.timelineZoomPivot;
  const anchorTime = pivot === "start" ? state.startTime ?? getDisplayedTimelineTime()
    : pivot === "end" ? state.endTime ?? getDisplayedTimelineTime() : getDisplayedTimelineTime();
  const nextSpan = state.duration / nextZoom;
  state.timelineZoom = nextZoom;
  state.timelineViewportStart = zoomViewportStart(previous.start, previous.span, nextSpan, anchorTime, state.duration);
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

function beginMarkerDrag(event: PointerEvent, marker: MarkerKind, relative = true): void {
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
  lastTimelineHandle = marker;
  state.draggingMarker = marker;
  state.markerAttachedPlayhead = null;
  const target = event.currentTarget as HTMLButtonElement;
  target.classList.add("dragging");
  capturePointer(target, event.pointerId);

  const initialTime = getTimeDragValue(marker);
  const initialX = event.clientX;
  const secondsPerPixel = getTimelineViewport().span / Math.max(1, elements.timelineInput.getBoundingClientRect().width);

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (relative) updateMarkerTime(marker, initialTime + (moveEvent.clientX - initialX) * secondsPerPixel, false);
    else updateMarkerFromPointer(marker, moveEvent.clientX);
  };

  const stop = (stopEvent: PointerEvent) => {
    if (stopEvent.pointerId !== event.pointerId) return;
    releasePointerCapture(target, stopEvent.pointerId);
    target.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    updateMarkerTime(marker, getTimeDragValue(marker), true);
    state.markerAttachedPlayhead = null;
    state.draggingMarker = null;
    state.timelineInteraction = null;
    renderMarkerOverlap();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  if (!relative) updateMarkerFromPointer(marker, event.clientX);
}

function updateMarkerFromPointer(marker: MarkerKind, clientX: number): void {
  const rect = elements.timelineInput.getBoundingClientRect();
  updateMarkerTime(marker, getTimelineTimeFromClientX(clientX, rect), false);
}

function updateMarkerTime(
  marker: MarkerKind,
  time: number,
  forceSeek: boolean,
  intent: MarkerEdit = "drag"
): void {
  const previous = marker === "start" ? state.startTime : state.endTime;
  const playhead = getDisplayedTimelineTime();
  const next = clampTime(time);
  state.rangeIsDefault = false;
  state.pendingLinkRange = null;

  const range = editMarker(marker, next, state.duration, state.startTime, state.endTime, intent);
  state.startTime = range.start;
  state.endTime = range.end;

  if (state.selectionMode === "clamp" &&
      (state.markerAttachedPlayhead === marker || shouldMovePlayheadWithMarker(marker, previous, next, playhead))) {
    if (intent === "drag" && state.draggingMarker === marker && state.markerAttachedPlayhead === null) {
      // Keep ownership until pointer release: player acknowledgements can lag behind
      // the pointer, and looping at the end would otherwise send it to the start.
      state.markerAttachedPlayhead = marker;
      state.playbackAllowed = false;
      state.player?.pauseVideo();
      updatePlaybackButton();
    }
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

const consumedShortcutKeys = new Set<string>();

function handleShortcuts(event: KeyboardEvent): void {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
    return;
  }

  if (event.isComposing) return;
  if (event.target instanceof HTMLElement && event.target.closest(".volume-control, .volume-popover") &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    ["ArrowUp", "ArrowDown", "Escape", "Home", "End"].includes(event.key)) return;
  const platform = new URLSearchParams(window.location.search).get("platform");
  const isMac = platform ? platform === "darwin" : /Mac/i.test(navigator.platform);
  const binding = shortcutFromEvent(event, isMac);
  const action = binding && SHORTCUT_ACTIONS.find(key => platformShortcut(state.preferences.shortcuts[key], isMac) === platformShortcut(binding, isMac));
  if (!action) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const input = target?.closest("input");
  const editingText = Boolean(target?.closest("textarea, [contenteditable]:not([contenteditable='false'])") ||
    (input && !["range", "checkbox", "radio", "button", "submit", "reset"].includes(input.type)));
  if (target?.closest("select, [role='combobox'], [role='listbox'], [role='menu'], [role='menuitem']")) return;
  if (editingText && (!(isMac ? event.metaKey : event.ctrlKey) ||
    (action !== "focusUrl" && action !== "newTab"))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  consumedShortcutKeys.add(event.code || event.key);
  if (event.repeat && !/^(small|large|fine|frame|volumeUp|volumeDown|zoomIn|zoomOut)/.test(action)) return;
  if (action === "volumeUp" || action === "volumeDown") {
    changeVolume(state.preferences.previewVolume + (action === "volumeUp" ? 0.05 : -0.05));
    return;
  }
  if (action === "mute") { updatePlaybackPreferences({ previewMuted: !state.preferences.previewMuted }); return; }
  if (action === "volumePopup") { setVolumeOpen(!volumeOpen); return; }
  if (action === "pivotPlayhead" || action === "pivotStart" || action === "pivotEnd") {
    const timelineZoomPivot: ZoomPivot = action === "pivotStart" ? "start" : action === "pivotEnd" ? "end" : "playhead";
    updatePlaybackPreferences({ timelineZoomPivot }); return;
  }
  if (action === "zoomIn" || action === "zoomOut") {
    zoomTimelineFromControl(action === "zoomIn" ? TIMELINE_ZOOM_STEP : 1 / TIMELINE_ZOOM_STEP); return;
  }
  if (action === "zoomReset") { resetTimelineZoom(); return; }
  if (action === "focusUrl") {
    event.preventDefault();
    elements.urlInput.focus();
    elements.urlInput.select();
    return;
  }

  if (action === "newTab") {
    event.preventDefault();
    void window.ytClipper.createBrowserTab();
    return;
  }

  if (action === "playPause") {
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (action === "modeClamp" || action === "modeFollow" || action === "modeFree") {
    changeSelectionMode(action === "modeClamp" ? "clamp" : action === "modeFollow" ? "follow" : "free");
    return;
  }

  if (action === "fineBack" || action === "fineForward") {
    event.preventDefault();
    seekRelative(action === "fineBack" ? -0.1 : 0.1);
    return;
  }

  if (action === "setStart") {
    event.preventDefault();
    setMarker("start");
    return;
  }

  if (action === "setEnd") {
    event.preventDefault();
    setMarker("end");
    return;
  }

  event.preventDefault();
  const direction = action.endsWith("Back") ? -1 : 1;
  if (action.startsWith("frame")) seekByFrame(direction);
  else seekRelative(direction * (action.startsWith("large")
    ? state.preferences.seekLargeSeconds : state.preferences.seekSmallSeconds));
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
  if (preset.id === "custom") {
    try { customEncodingPreset((document.getElementById("customFfmpegArgs") as HTMLTextAreaElement).value, preset.extension); }
    catch { setProgressLabel(t("encoding.invalidOptions")); return; }
  }

  if (
    editingItem &&
    extractVideoId(editingItem.payload.url) === videoId
  ) {
    const companionRequestId = getCompanionRequestId();
    if (companionRequestId) editingItem.companionRequestId = companionRequestId;
    await updateExistingQueueItem(editingItem, segments, basename, preset);
    return;
  }

  const itemId = createQueueItemId();
  const payload: DownloadRequest = {
    url,
    segments,
    downloadQuality: elements.downloadQualitySelect.value,
    speedLimit: elements.speedLimitSelect.value,
    ...getEncodingRequestOptions(),
    basename,
    outputDir: elements.outputDirInput.value.trim(),
    locale: getLocale(),
    resumeKey: itemId,
    skipSegmentKeys: [],
    keepSourceCache: true
  };
  const companionRequestId = getCompanionRequestId();
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
    editorSnapshot: captureEditorSnapshot(segments),
    ...(companionRequestId ? { companionRequestId } : {})
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
    ...getEncodingRequestOptions(),
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
  const link = parseSourceLink(item.payload.url);
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
  setRendererSelectValue(document.getElementById("encodingModeSelect") as HTMLButtonElement, item.payload.encodingPreset === "custom" ? "custom" : "preset");
  (document.getElementById("customFfmpegArgs") as HTMLTextAreaElement).value = item.payload.customFfmpegArgs ?? DEFAULT_CUSTOM_ARGS;
  setRendererSelectValue(document.getElementById("customExtensionSelect") as HTMLButtonElement, item.payload.customExtension ?? "mp4");
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
  if (presetId === "custom") return t("encoding.custom");
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

function updateDuration(metadataDuration?: number): void {
  const loadedVideoId = state.player?.getVideoData?.().video_id;
  if (
    state.expectedVideoId &&
    loadedVideoId &&
    loadedVideoId !== state.expectedVideoId
  ) {
    return;
  }

  const duration = metadataDuration ?? state.player?.getDuration?.() ?? 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  if (Math.abs(duration - state.duration) < 0.01) {
    return;
  }

  const endWasAtVideoEnd =
    state.endTime !== null && Math.abs(state.endTime - state.duration) < 0.01;
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
    // Media metadata can refine the duration after the initial ready event.
    // Keep an end marker at the video boundary attached to that boundary.
    if (endWasAtVideoEnd) state.endTime = duration;
    syncRangeDisplay();
  }
  renderTimeline();
}

function updateVideoMeta(metadataTitle?: string): void {
  const data = state.player?.getVideoData?.();
  const title = (metadataTitle ?? data?.title)?.trim() || "";

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
  const draggingTag = elements.splitStartMarker.classList.contains("dragging") || elements.splitEndMarker.classList.contains("dragging");
  elements.markerSplitTags.classList.toggle("hidden", !overlap && !draggingTag);
  if (overlap || draggingTag) {
    const width = elements.timelineShell.clientWidth;
    const startWidth = elements.splitStartMarker.offsetWidth;
    const endWidth = elements.splitEndMarker.offsetWidth;
    // Each tag tracks its own marker, even after the markers separate. Shift
    // inward only at viewport edges so both handles stay visible and distinct.
    const startLeft = Math.max(0, Math.min(
      width - startWidth - endWidth - 4,
      width * getTimelinePercent(state.startTime ?? 0) / 100 - startWidth - 2
    ));
    const endLeft = Math.min(width - endWidth, Math.max(
      startLeft + startWidth + 4,
      width * getTimelinePercent(state.endTime ?? state.duration) / 100 + 2
    ));
    elements.splitStartMarker.style.left = `${startLeft}px`;
    elements.splitEndMarker.style.left = `${endLeft}px`;
  }
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
  const signature = [viewport.start, viewport.end, width].join(":");
  if (signature === timelineRulerSignature) return;
  timelineRulerSignature = signature;
  setTimelineRulerViewItems(buildTimelineTicks(viewport, width, formatTimelineRulerTime));
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

  const next = constrainPlayhead(clampTime(time));
  beginPendingSeek(next);

  const now = performance.now();
  if (forceSeek || now - state.lastTimelineSeekAt >= 80) {
    state.player.seekTo(next, allowSeekAhead);
    state.lastTimelineSeekAt = now;
  }
}

function changeSelectionMode(mode: SelectionMode): void {
  state.selectionMode = mode;
  setSelectionModeView(mode);
  if (state.playerReady) requestTimelineSeek(getDisplayedTimelineTime(), true, true);
}

function constrainPlayhead(time: number): number {
  const next = movePlayhead(state.selectionMode, time, state.duration, state.startTime, state.endTime);
  if (next.start !== state.startTime || next.end !== state.endTime) {
    state.startTime = next.start;
    state.endTime = next.end;
    state.rangeIsDefault = false;
    syncRangeDisplay();
  }
  return next.time;
}

function beginPendingSeek(time: number): void {
  const next = clampTime(time);
  state.pendingSeekTime = next;
  state.currentTime = next;
  if (!state.isScrubbing) ensureTimelineTimeVisible(next);
  renderTimeline();
}

function reconcilePendingSeek(playerTime: number): void {
  if (state.pendingSeekTime === null || !Number.isFinite(playerTime)) {
    return;
  }

  // The drag is authoritative until its final forced seek on release.
  if (state.timelineInteraction !== null || state.player?.isSeeking()) return;

  const settled =
    Math.abs(playerTime - state.pendingSeekTime) <= SEEK_SETTLE_EPSILON;
  if (settled) {
    state.pendingSeekTime = null;
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

function getCompanionRequestId(): string | null {
  const value = new URLSearchParams(window.location.search).get("companionRequestId");
  return value && /^[A-Za-z0-9-]{8,100}$/.test(value) ? value : null;
}

function parseSourceLink(input: string): {
  videoId: string | null;
  timeRange: LinkTimeRange | null;
} {
  const source = parseVideoSource(input);
  if (!source) {
    return { videoId: null, timeRange: null };
  }
  try {
    const url = new URL(input.trim());
    return {
      videoId: source.key,
      timeRange: source.site === "youtube" ? getYouTubeLinkTimeRange(url) : null
    };
  } catch {
    return { videoId: null, timeRange: null };
  }
}

function extractVideoId(input: string): string | null {
  return parseSourceLink(input).videoId;
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
