const LOOP_EPSILON = 0.05;
const SEEK_SETTLE_EPSILON = 0.35;
const QUEUE_LOG_LIMIT = 120;
const DEFAULT_OUTPUT_DIR = "";
const OUTPUT_PRESETS = [
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

const state = {
  player: null,
  playerReady: false,
  currentTime: 0,
  duration: 0,
  videoTitle: "",
  startTime: null,
  endTime: null,
  rangeIsDefault: true,
  pendingLinkRange: null,
  segments: [],
  nextSegmentId: 1,
  loopEnabled: false,
  isScrubbing: false,
  draggingMarker: null,
  pendingSeekTime: null,
  pendingSeekStartedAt: 0,
  lastTimelineSeekAt: 0,
  activeJobId: null,
  downloadQueue: [],
  activeQueueItemId: null,
  isQueueRunning: false,
  lastOutputPath: null
};

const elements = {
  urlInput: document.querySelector("#urlInput"),
  loadButton: document.querySelector("#loadButton"),
  videoInfo: document.querySelector("#videoInfo"),
  videoTitle: document.querySelector("#videoTitle"),
  playerStage: document.querySelector("#playerStage"),
  player: document.querySelector("#player"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  timelineInput: document.querySelector("#timelineInput"),
  timelineFill: document.querySelector("#timelineFill"),
  timelineRange: document.querySelector("#timelineRange"),
  timelineSegments: document.querySelector("#timelineSegments"),
  currentTimeAnchor: document.querySelector("#currentTimeAnchor"),
  startMarkerHandle: document.querySelector("#startMarkerHandle"),
  endMarkerHandle: document.querySelector("#endMarkerHandle"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  rangeSummary: document.querySelector("#rangeSummary"),
  setStartButton: document.querySelector("#setStartButton"),
  setEndButton: document.querySelector("#setEndButton"),
  resetSelectionButton: document.querySelector("#resetSelectionButton"),
  addSegmentButton: document.querySelector("#addSegmentButton"),
  clearSegmentsButton: document.querySelector("#clearSegmentsButton"),
  segmentCount: document.querySelector("#segmentCount"),
  segmentList: document.querySelector("#segmentList"),
  playPauseButton: document.querySelector("#playPauseButton"),
  backFineButton: document.querySelector("#backFineButton"),
  backButton: document.querySelector("#backButton"),
  forwardButton: document.querySelector("#forwardButton"),
  forwardFineButton: document.querySelector("#forwardFineButton"),
  loopToggle: document.querySelector("#loopToggle"),
  setupViewButton: document.querySelector("#setupViewButton"),
  queueViewButton: document.querySelector("#queueViewButton"),
  queueBadge: document.querySelector("#queueBadge"),
  setupView: document.querySelector("#setupView"),
  queueView: document.querySelector("#queueView"),
  setupStatusLabel: document.querySelector("#setupStatusLabel"),
  queueSummary: document.querySelector("#queueSummary"),
  queueList: document.querySelector("#queueList"),
  basenameInput: document.querySelector("#basenameInput"),
  outputDirInput: document.querySelector("#outputDirInput"),
  selectFolderButton: document.querySelector("#selectFolderButton"),
  downloadQualitySelect: document.querySelector("#downloadQualitySelect"),
  speedLimitSelect: document.querySelector("#speedLimitSelect"),
  encodingPresetSelect: document.querySelector("#encodingPresetSelect"),
  presetDetails: document.querySelector("#presetDetails"),
  presetFormatList: document.querySelector("#presetFormatList"),
  downloadButton: document.querySelector("#downloadButton"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  logOutput: document.querySelector("#logOutput"),
  ytDlpStatus: document.querySelector("#ytDlpStatus"),
  ffmpegStatus: document.querySelector("#ffmpegStatus"),
  openOutputButton: document.querySelector("#openOutputButton")
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
  elements.backFineButton.addEventListener("click", () => seekRelative(-0.1));
  elements.backButton.addEventListener("click", () => seekRelative(-1));
  elements.forwardButton.addEventListener("click", () => seekRelative(1));
  elements.forwardFineButton.addEventListener("click", () => seekRelative(0.1));
  elements.timelineInput.addEventListener("pointerdown", (event) => {
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
}

function switchDownloadView(view) {
  const showQueue = view === "queue";
  elements.setupViewButton.classList.toggle("active", !showQueue);
  elements.queueViewButton.classList.toggle("active", showQueue);
  elements.setupView.classList.toggle("active", !showQueue);
  elements.setupView.classList.toggle("hidden", showQueue);
  elements.queueView.classList.toggle("active", showQueue);
  elements.queueView.classList.toggle("hidden", !showQueue);
}

async function loadDependencies() {
  const status = await window.ytClipper.getDependencyStatus();
  renderDependency(elements.ytDlpStatus, "yt-dlp", status.ytDlp);
  renderDependency(elements.ffmpegStatus, "ffmpeg", status.ffmpeg);
}

function renderDependency(element, name, status) {
  element.classList.toggle("ready", status.available);
  element.classList.toggle("missing", !status.available);
  element.textContent = status.available
    ? `${name}: ${status.version}`
    : `${name}: 필요함`;
}

function renderEncodingPresetOptions() {
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

function renderEncodingPresetDetails() {
  const preset = getSelectedOutputPreset();

  const title = document.createElement("div");
  title.className = "preset-title";
  title.textContent = `${preset.name} -> .${preset.extension}`;

  const meta = document.createElement("div");
  meta.className = "preset-meta";
  meta.textContent = `${preset.target} | ${preset.container} / ${preset.video} / ${preset.audio}`;

  elements.presetDetails.replaceChildren(title, meta);
}

function getSelectedOutputPreset() {
  return (
    OUTPUT_PRESETS.find((preset) => preset.id === elements.encodingPresetSelect.value) ||
    OUTPUT_PRESETS[0]
  );
}

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = () => {
  const pendingLink = parseYouTubeLink(elements.urlInput.value);
  if (pendingLink.videoId) {
    createOrLoadPlayer(pendingLink.videoId, pendingLink.timeRange);
  }
};

function loadVideoFromInput() {
  const link = parseYouTubeLink(elements.urlInput.value);
  const videoId = link.videoId;
  if (!videoId) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  createOrLoadPlayer(videoId, link.timeRange);
  if (!elements.basenameInput.value.trim()) {
    elements.basenameInput.value = `clip-${videoId}`;
  }
}

function createOrLoadPlayer(videoId, initialRange = null) {
  resetMarkers();
  state.pendingLinkRange = initialRange;
  elements.playerStage.classList.add("has-video");

  if (state.player?.loadVideoById) {
    state.player.loadVideoById(videoId);
    window.setTimeout(() => {
      updateVideoMeta();
      updatePlaybackButton();
    }, 200);
    return;
  }

  if (!window.YT?.Player) {
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
      onStateChange: updatePlaybackButton
    }
  });
}

function resetMarkers() {
  state.startTime = null;
  state.endTime = null;
  state.rangeIsDefault = true;
  state.pendingLinkRange = null;
  state.segments = [];
  state.nextSegmentId = 1;
  state.currentTime = 0;
  state.duration = 0;
  state.videoTitle = "";
  state.isScrubbing = false;
  state.draggingMarker = null;
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

function startTicker() {
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

function setMarker(kind) {
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
    if (state.endTime !== null && state.endTime <= state.startTime) {
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

function resetSelectionToFullVideo() {
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

function applyFullVideoRange() {
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

function applyLinkTimeRange(range) {
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

function syncRangeDisplay() {
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

function addSegmentFromSelection() {
  const segment = getSelectionSegment();
  if (!segment) {
    return;
  }

  state.segments.push({
    id: state.nextSegmentId,
    start: segment.start,
    end: segment.end
  });
  state.nextSegmentId += 1;
  state.segments.sort((a, b) => a.start - b.start || a.end - b.end);

  renderSegmentList();
  renderTimeline();
  setProgressLabel(`구간 ${state.segments.length}개가 목록에 있습니다.`);
}

function clearSegments() {
  if (state.segments.length === 0) {
    return;
  }

  state.segments = [];
  renderSegmentList();
  renderTimeline();
  setProgressLabel("구간 목록을 비웠습니다.");
}

function removeSegment(segmentId) {
  state.segments = state.segments.filter((segment) => segment.id !== segmentId);
  renderSegmentList();
  renderTimeline();
  setProgressLabel(`구간 ${state.segments.length}개가 목록에 있습니다.`);
}

function loadSegmentToMarkers(segment) {
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

function getSelectionSegment() {
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

function getDownloadSegments() {
  if (state.segments.length > 0) {
    return state.segments.map((segment) => ({
      start: segment.start,
      end: segment.end
    }));
  }

  const segment = getSelectionSegment();
  return segment ? [segment] : null;
}

function renderSegmentList() {
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

function updateDownloadButtonLabel() {
  const count = state.segments.length;
  if (count === 0 && state.rangeIsDefault && state.startTime !== null && state.endTime !== null) {
    elements.downloadButton.textContent = "전체 영상 큐에 추가";
    return;
  }

  elements.downloadButton.textContent =
    count > 0 ? `${count}개 구간 큐에 추가` : "선택 구간 큐에 추가";
}

function togglePlayback() {
  if (!state.playerReady) {
    return;
  }

  const playerState = state.player.getPlayerState();
  if (playerState === window.YT.PlayerState.PLAYING) {
    state.player.pauseVideo();
  } else {
    state.player.playVideo();
  }
}

function updatePlaybackButton() {
  if (!state.playerReady) {
    return;
  }

  const playerState = state.player.getPlayerState();
  const playing = playerState === window.YT.PlayerState.PLAYING;
  elements.playPauseButton.textContent = playing ? "정지" : "재생";
  updateVideoMeta();
}

function seekRelative(delta) {
  if (!state.playerReady) {
    return;
  }

  const next = getCurrentTimelineTime() + delta;
  seekToTimelineTime(next, true);
}

function seekTimelineFromPointer(event, forceSeek) {
  if (!state.playerReady || state.duration <= 0) {
    return;
  }

  const rect = elements.timelineInput.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
  requestTimelineSeek(ratio * state.duration, true, forceSeek);
}

function scrubTimeline(event) {
  if (!state.playerReady) {
    return;
  }

  const next = Number(event.target.value);
  requestTimelineSeek(next, true, false);
}

function finishTimelineScrub() {
  if (!state.playerReady) {
    state.isScrubbing = false;
    return;
  }

  seekToTimelineTime(Number(elements.timelineInput.value), true);
  state.isScrubbing = false;
}

function beginMarkerDrag(event, marker) {
  if (!state.playerReady || state.duration <= 0) {
    return;
  }

  event.preventDefault();
  state.draggingMarker = marker;
  event.currentTarget.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    updateMarkerFromPointer(marker, moveEvent.clientX);
  };

  const stop = (stopEvent) => {
    try {
      event.currentTarget.releasePointerCapture(stopEvent.pointerId);
    } catch {
      // Pointer capture can already be gone if the drag is canceled by the OS.
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    state.draggingMarker = null;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  updateMarkerFromPointer(marker, event.clientX);
}

function updateMarkerFromPointer(marker, clientX) {
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

function handleShortcuts(event) {
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

function downloadSection() {
  const url = elements.urlInput.value.trim();
  if (!extractVideoId(url)) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  const segments = getDownloadSegments();
  if (!segments) {
    return;
  }

  const basename =
    elements.basenameInput.value.trim() || `clip-${new Date().toISOString()}`;
  const preset = getSelectedOutputPreset();
  const payload = {
    url,
    segments,
    downloadQuality: elements.downloadQualitySelect.value,
    speedLimit: elements.speedLimitSelect.value,
    encodingPreset: elements.encodingPresetSelect.value,
    basename,
    outputDir: elements.outputDirInput.value.trim()
  };
  const item = {
    id: createQueueItemId(),
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
    log: []
  };

  appendQueueLog(item, "[queue] 작업이 큐에 추가됨");
  state.downloadQueue.push(item);
  setProgressLabel(`큐에 추가됨: ${item.title}`);
  renderDownloadQueue();
  switchDownloadView("queue");
  runDownloadQueue();
}

function handleDownloadProgress(payload) {
  const item = getActiveQueueItem();
  if (item) {
    if (payload.jobId && !item.jobId) {
      item.jobId = payload.jobId;
      state.activeJobId = payload.jobId;
    }

    if (payload.progress !== undefined) {
      item.progress = clampProgress(payload.progress);
    }

    if (payload.message) {
      item.message = payload.message;
      appendQueueLog(item, `[${payload.stage || "progress"}] ${payload.message}`);
    }

    if (payload.outputPath) {
      item.outputPath = payload.outputPath;
      state.lastOutputPath = payload.outputPath;
    }

    renderDownloadQueue();
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

async function runDownloadQueue() {
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

      state.activeQueueItemId = item.id;
      state.activeJobId = null;
      item.status = "running";
      item.progress = 0;
      item.message = "다운로드 시작 중";
      item.error = null;
      item.log = [];
      appendQueueLog(item, "[start] 다운로드 시작");
      renderDownloadQueue();

      try {
        const result = await window.ytClipper.downloadSection(item.payload);
        if (result?.ok) {
          const outputPaths = Array.isArray(result.outputPaths)
            ? result.outputPaths.filter(Boolean)
            : [];
          const outputPath = result.outputPath || outputPaths[0] || null;

          item.status = "done";
          item.progress = 1;
          item.outputPath = outputPath;
          item.outputPaths = outputPaths.length
            ? outputPaths
            : outputPath
              ? [outputPath]
              : [];
          item.message =
            item.outputPaths.length > 1
              ? `완료: 파일 ${item.outputPaths.length}개 생성`
              : "완료";
          state.lastOutputPath = outputPath;
          appendQueueLog(item, `[done] ${item.message}`);
        } else {
          item.status = "error";
          item.error = result?.error || "다운로드에 실패했습니다.";
          item.message = item.error;
          appendQueueLog(item, `[error] ${item.error}`);
        }
      } catch (error) {
        item.status = "error";
        item.error = error?.message || "다운로드에 실패했습니다.";
        item.message = item.error;
        appendQueueLog(item, `[error] ${item.error}`);
      }

      state.activeQueueItemId = null;
      state.activeJobId = null;
      renderDownloadQueue();
    }
  } finally {
    state.isQueueRunning = false;
    renderDownloadQueue();
  }
}

function renderDownloadQueue() {
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
    return;
  }

  const rows = state.downloadQueue.map((item, index) => createQueueRow(item, index));
  elements.queueList.replaceChildren(...rows);
  renderActiveProgress();
}

function createQueueRow(item, index) {
  const row = document.createElement("div");
  row.className = `queue-row ${item.status}`;

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
  meta.textContent = `${item.segmentsCount}구간 · ${item.qualityLabel} · ${item.presetName} · ${item.speedLabel}`;

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

  if (item.outputPath) {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "queue-open-button";
    openButton.textContent = "열기";
    openButton.addEventListener("click", () => window.ytClipper.openOutput(item.outputPath));
    footer.append(openButton);
  }

  row.append(header, meta, track, footer);
  return row;
}

function renderActiveProgress() {
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

function getActiveQueueItem() {
  if (!state.activeQueueItemId) {
    return null;
  }

  return state.downloadQueue.find((item) => item.id === state.activeQueueItemId) || null;
}

function getLastVisibleQueueItem() {
  return (
    [...state.downloadQueue]
      .reverse()
      .find((item) => item.status !== "queued") ||
    state.downloadQueue[state.downloadQueue.length - 1] ||
    null
  );
}

function appendQueueLog(item, line) {
  item.log = [...(item.log || []), line].slice(-QUEUE_LOG_LIMIT);
}

function createQueueItemId() {
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedOptionText(select) {
  return select.selectedOptions[0]?.textContent?.trim() || "";
}

function getQueueStatusLabel(status) {
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

function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function setProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  elements.progressFill.style.width = `${percent}%`;
}

function updateDuration() {
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
  if (state.pendingLinkRange) {
    applyLinkTimeRange(state.pendingLinkRange);
  } else if (state.rangeIsDefault) {
    applyFullVideoRange();
  } else {
    syncRangeDisplay();
  }
  renderTimeline();
}

function updateVideoMeta() {
  const data = state.player?.getVideoData?.();
  const title = data?.title?.trim() || "";

  if (!title || title === state.videoTitle) {
    return;
  }

  state.videoTitle = title;
  elements.videoTitle.textContent = title;
  elements.videoInfo.classList.remove("hidden");
}

function renderTimeline() {
  const duration = state.duration;
  const current = getDisplayedTimelineTime();

  elements.currentTime.textContent = formatTime(current);
  elements.timelineInput.value = String(current);

  const currentPercent = getTimelinePercent(current);
  elements.timelineFill.style.width = `${currentPercent}%`;

  renderCurrentAnchor(current);
  renderMarker(elements.startMarkerHandle, state.startTime);
  renderMarker(elements.endMarkerHandle, state.endTime);
  renderTimelineSegments();
  renderSelectedRange();
}

function renderCurrentAnchor(time) {
  if (state.duration <= 0) {
    elements.currentTimeAnchor.classList.add("hidden");
    return;
  }

  elements.currentTimeAnchor.classList.remove("hidden");
  elements.currentTimeAnchor.classList.toggle("seeking", state.pendingSeekTime !== null);
  elements.currentTimeAnchor.style.left = `${getTimelinePercent(time)}%`;
}

function getDisplayedTimelineTime() {
  return clampTime(state.pendingSeekTime ?? state.currentTime);
}

function renderMarker(element, time) {
  if (time === null || state.duration <= 0) {
    element.classList.add("hidden");
    return;
  }

  element.classList.remove("hidden");
  element.style.left = `${getTimelinePercent(time)}%`;
}

function renderSelectedRange() {
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

function renderTimelineSegments() {
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

function getTimelinePercent(time) {
  if (state.duration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (time / state.duration) * 100));
}

function getCurrentTimelineTime() {
  if (state.isScrubbing) {
    return Number(elements.timelineInput.value) || 0;
  }

  if (state.pendingSeekTime !== null) {
    return state.pendingSeekTime;
  }

  const playerTime = state.player?.getCurrentTime?.();
  return Number.isFinite(playerTime) ? playerTime : state.currentTime || 0;
}

function seekToTimelineTime(time, allowSeekAhead) {
  if (!state.playerReady) {
    return;
  }

  requestTimelineSeek(time, allowSeekAhead, true);
}

function requestTimelineSeek(time, allowSeekAhead, forceSeek) {
  if (!state.playerReady) {
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

function beginPendingSeek(time) {
  const next = clampTime(time);
  state.pendingSeekTime = next;
  state.pendingSeekStartedAt = performance.now();
  state.currentTime = next;
  renderTimeline();
}

function reconcilePendingSeek(playerTime) {
  if (state.pendingSeekTime === null || !Number.isFinite(playerTime)) {
    return;
  }

  if (Math.abs(playerTime - state.pendingSeekTime) <= SEEK_SETTLE_EPSILON) {
    state.pendingSeekTime = null;
    state.pendingSeekStartedAt = 0;
    state.currentTime = playerTime;
  }
}

function clampTime(time) {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const upper = state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(upper, numeric));
}

function setProgressLabel(message) {
  elements.setupStatusLabel.textContent = message;
  elements.progressLabel.textContent = message;
}

function clearLog() {
  elements.logOutput.textContent = "";
}

function appendLog(line) {
  const current = elements.logOutput.textContent;
  const next = `${current}${current ? "\n" : ""}${line}`.split("\n").slice(-120);
  elements.logOutput.textContent = next.join("\n");
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

function parseYouTubeLink(input) {
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

function extractVideoId(input) {
  return parseYouTubeLink(input).videoId;
}

function getYouTubeVideoId(url) {
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

function getYouTubeLinkTimeRange(url) {
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

function getUrlParamSets(url) {
  const paramSets = [url.searchParams];
  const hash = url.hash.replace(/^#/, "").replace(/^\?/, "");

  if (hash.includes("=")) {
    paramSets.push(new URLSearchParams(hash));
  }

  return paramSets;
}

function getFirstTimeParam(paramSets, names) {
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

function parseLinkTimeValue(value) {
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

function formatTime(totalSeconds) {
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function padSeconds(value) {
  return value.toFixed(3).padStart(6, "0");
}
