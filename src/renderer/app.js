const LOOP_EPSILON = 0.05;
const DEFAULT_OUTPUT_DIR = "";

const state = {
  player: null,
  playerReady: false,
  currentTime: 0,
  duration: 0,
  videoTitle: "",
  startTime: null,
  endTime: null,
  loopEnabled: false,
  isScrubbing: false,
  draggingMarker: null,
  lastTimelineSeekAt: 0,
  activeJobId: null,
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
  startMarkerHandle: document.querySelector("#startMarkerHandle"),
  endMarkerHandle: document.querySelector("#endMarkerHandle"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  setStartButton: document.querySelector("#setStartButton"),
  setEndButton: document.querySelector("#setEndButton"),
  playPauseButton: document.querySelector("#playPauseButton"),
  backFineButton: document.querySelector("#backFineButton"),
  backButton: document.querySelector("#backButton"),
  forwardButton: document.querySelector("#forwardButton"),
  forwardFineButton: document.querySelector("#forwardFineButton"),
  loopToggle: document.querySelector("#loopToggle"),
  basenameInput: document.querySelector("#basenameInput"),
  outputDirInput: document.querySelector("#outputDirInput"),
  selectFolderButton: document.querySelector("#selectFolderButton"),
  downloadButton: document.querySelector("#downloadButton"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  logOutput: document.querySelector("#logOutput"),
  ytDlpStatus: document.querySelector("#ytDlpStatus"),
  ffmpegStatus: document.querySelector("#ffmpegStatus"),
  openOutputButton: document.querySelector("#openOutputButton")
};

elements.outputDirInput.value = DEFAULT_OUTPUT_DIR;

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
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.backFineButton.addEventListener("click", () => seekRelative(-0.1));
  elements.backButton.addEventListener("click", () => seekRelative(-1));
  elements.forwardButton.addEventListener("click", () => seekRelative(1));
  elements.forwardFineButton.addEventListener("click", () => seekRelative(0.1));
  elements.timelineInput.addEventListener("pointerdown", () => {
    state.isScrubbing = true;
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

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = () => {
  const pendingVideoId = extractVideoId(elements.urlInput.value);
  if (pendingVideoId) {
    createOrLoadPlayer(pendingVideoId);
  }
};

function loadVideoFromInput() {
  const videoId = extractVideoId(elements.urlInput.value);
  if (!videoId) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  createOrLoadPlayer(videoId);
  if (!elements.basenameInput.value.trim()) {
    elements.basenameInput.value = `clip-${videoId}`;
  }
}

function createOrLoadPlayer(videoId) {
  resetMarkers();
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
  state.currentTime = 0;
  state.duration = 0;
  state.videoTitle = "";
  state.isScrubbing = false;
  state.draggingMarker = null;
  elements.videoTitle.textContent = "";
  elements.videoInfo.classList.add("hidden");
  elements.startTime.textContent = "--:--.---";
  elements.endTime.textContent = "--:--.---";
  elements.durationTime.textContent = "--:--.---";
  elements.timelineInput.value = "0";
  elements.timelineInput.max = "0";
  elements.timelineInput.disabled = true;
  renderTimeline();
}

function startTicker() {
  window.setInterval(() => {
    if (!state.playerReady || !state.player?.getCurrentTime) {
      return;
    }

    updateDuration();

    if (!state.isScrubbing && !state.draggingMarker) {
      state.currentTime = state.player.getCurrentTime();
      renderTimeline();
    }

    if (
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

  renderTimeline();
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

function scrubTimeline(event) {
  if (!state.playerReady) {
    return;
  }

  const next = Number(event.target.value);
  state.currentTime = clampTime(next);
  renderTimeline();

  const now = performance.now();
  if (now - state.lastTimelineSeekAt >= 80) {
    state.player.seekTo(state.currentTime, true);
    state.lastTimelineSeekAt = now;
  }
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

async function downloadSection() {
  const url = elements.urlInput.value.trim();
  if (!extractVideoId(url)) {
    setProgressLabel("유효한 YouTube URL을 입력해 주세요.");
    return;
  }

  if (state.startTime === null || state.endTime === null) {
    setProgressLabel("시작 지점과 끝 지점을 먼저 설정해 주세요.");
    return;
  }

  if (state.endTime <= state.startTime) {
    setProgressLabel("끝 지점은 시작 지점보다 뒤에 있어야 합니다.");
    return;
  }

  elements.downloadButton.disabled = true;
  elements.openOutputButton.classList.add("hidden");
  state.lastOutputPath = null;
  setProgress(0);
  clearLog();

  const selectedMode = document.querySelector("input[name='cutMode']:checked").value;
  const basename =
    elements.basenameInput.value.trim() || `clip-${new Date().toISOString()}`;

  try {
    const result = await window.ytClipper.downloadSection({
      url,
      start: state.startTime,
      end: state.endTime,
      mode: selectedMode,
      basename,
      outputDir: elements.outputDirInput.value.trim()
    });

    if (result.ok) {
      state.lastOutputPath = result.outputPath;
      elements.openOutputButton.classList.remove("hidden");
    } else {
      setProgressLabel(result.error || "다운로드에 실패했습니다.");
    }
  } finally {
    elements.downloadButton.disabled = false;
  }
}

function handleDownloadProgress(payload) {
  if (payload.progress !== undefined) {
    setProgress(payload.progress);
  }

  if (payload.message) {
    setProgressLabel(payload.message);
    appendLog(`[${payload.stage}] ${payload.message}`);
  }
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
  const current = clampTime(state.currentTime);

  elements.currentTime.textContent = formatTime(current);
  elements.timelineInput.value = String(current);

  const currentPercent = getTimelinePercent(current);
  elements.timelineFill.style.width = `${currentPercent}%`;

  renderMarker(elements.startMarkerHandle, state.startTime);
  renderMarker(elements.endMarkerHandle, state.endTime);
  renderSelectedRange();
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

  const playerTime = state.player?.getCurrentTime?.();
  return Number.isFinite(playerTime) ? playerTime : state.currentTime || 0;
}

function seekToTimelineTime(time, allowSeekAhead) {
  if (!state.playerReady) {
    return;
  }

  const next = clampTime(time);
  state.currentTime = next;
  state.player.seekTo(next, allowSeekAhead);
  renderTimeline();
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

function extractVideoId(input) {
  try {
    const url = new URL(input.trim());
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
  } catch {
    return null;
  }

  return null;
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
