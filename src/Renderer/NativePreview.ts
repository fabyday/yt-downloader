import type { PreviewResult } from "../Shared/types";
import { isPreviewMediaUrl } from "../Shared/VideoSource";
import type Hls from "hls.js";

export class NativePreview implements PreviewPlayer {
  private readonly video = document.createElement("video");
  private readonly audio: HTMLAudioElement | null;
  private readonly timeout: number;
  private disposed = false;
  private failed = false;
  private ready = false;
  private framePresented = false;
  private wantsPlayback = false;
  private presentedTime: number | null = null;
  private queuedSeek: number | null = null;
  private volume = 1;
  private muted = false;
  private hls: Hls | null = null;
  constructor(private readonly source: Extract<PreviewResult, { ok: true }>,
    onReady: () => void, onChange: () => void, onError: () => void) {
    this.video.id = "player";
    this.video.className = "native-preview";
    this.video.preload = "auto";
    this.video.playsInline = true;
    // Do not let a muxed audio track become audible before its first video frame.
    this.video.muted = true;
    this.audio = source.audioUrl ? new Audio() : null;
    this.timeout = window.setTimeout(() => { if (!this.ready && !this.disposed) fail(); }, 25_000);
    const fail = () => {
      if (this.disposed || this.failed) return;
      this.failed = true;
      clearTimeout(this.timeout);
      this.hls?.stopLoad();
      this.pauseVideo();
      onError();
    };
    const checkReady = () => {
      if (this.ready || this.disposed || this.failed || !this.framePresented || this.video.readyState < 2 || (this.audio && this.audio.readyState < 2)) return;
      this.ready = true;
      this.applyVolume();
      clearTimeout(this.timeout);
      onReady();
    };
    this.video.addEventListener("loadeddata", checkReady);
    const presentedFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (this.disposed || this.failed) return;
      this.framePresented = this.video.videoWidth > 0 && this.video.videoHeight > 0;
      this.presentedTime = metadata?.mediaTime ?? this.video.currentTime;
      checkReady();
      this.video.requestVideoFrameCallback(presentedFrame);
    };
    this.video.requestVideoFrameCallback(presentedFrame);
    this.video.addEventListener("error", fail);
    this.video.addEventListener("waiting", () => this.audio?.pause());
    this.video.addEventListener("seeking", () => this.audio?.pause());
    this.video.addEventListener("seeked", () => {
      if (this.disposed || this.failed) return;
      if (this.queuedSeek !== null) {
        const next = this.queuedSeek;
        this.queuedSeek = null;
        if (Math.abs(next - this.video.currentTime) > 0.001) { this.video.currentTime = next; return; }
      }
      if (!this.audio) return;
      this.audio.currentTime = this.video.currentTime;
      if (this.ready && this.wantsPlayback && !this.video.paused) void this.audio.play().catch(fail);
    });
    this.video.addEventListener("playing", () => {
      if (!this.audio || this.disposed || !this.ready || !this.wantsPlayback || this.video.paused) return;
      this.audio.currentTime = this.video.currentTime;
      void this.audio.play().catch(fail);
    });
    this.video.addEventListener("timeupdate", () => {
      if (this.audio && !this.video.paused && !this.video.seeking && !this.audio.seeking && Math.abs(this.audio.currentTime - this.video.currentTime) > 0.2) {
        this.audio.currentTime = this.video.currentTime;
      }
    });
    this.video.addEventListener("ended", () => this.audio?.pause());
    this.video.addEventListener("pause", () => this.audio?.pause());
    if (this.audio) {
      this.audio.preload = "auto";
      this.audio.addEventListener("loadeddata", checkReady);
      this.audio.addEventListener("error", fail);
      this.audio.src = source.audioUrl!;
    }
    for (const event of ["play", "pause", "ended", "seeked"]) this.video.addEventListener(event, () => {
      if (!this.disposed && this.ready) onChange();
    });
    document.getElementById("player")?.replaceWith(this.video);
    if (source.transport === "hls") void this.loadHls(fail);
    else this.video.src = source.url;
  }
  private async loadHls(fail: () => void): Promise<void> {
    try {
      const { default: Hls } = await import("hls.js");
      if (this.disposed || this.failed) return;
      if (!Hls.isSupported()) { fail(); return; }
      const site = this.source.videoId.startsWith("web:") ? "generic" : this.source.videoId.startsWith("chzzk:") ? "chzzk" : "youtube";
      this.hls = new Hls({ maxBufferLength: 30, backBufferLength: 30,
        xhrSetup: (_xhr, url) => {
          if (!isPreviewMediaUrl(url, site)) throw new Error("Unsupported media host");
        } });
      this.hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
      this.hls.loadSource(this.source.url);
      this.hls.attachMedia(this.video);
    } catch { fail(); }
  }
  getCurrentTime(): number {
    // During playback, follow frames actually submitted to the compositor, not an audio/media clock
    // that may continue while video decoding is stalled. Explicit seeks retain their target in app.ts.
    return !this.video.paused && !this.video.seeking && this.presentedTime !== null
      ? this.presentedTime : this.video.currentTime;
  }
  setVolume(volume: number, muted: boolean): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    this.muted = muted;
    this.applyVolume();
  }
  private applyVolume(): void {
    this.video.volume = this.volume;
    this.video.muted = !this.ready || this.muted;
    if (this.audio) { this.audio.volume = this.volume; this.audio.muted = this.muted; }
  }
  isSeeking(): boolean { return this.video.seeking || this.queuedSeek !== null; }
  getDuration(): number { return Number.isFinite(this.video.duration) ? this.video.duration : 0; }
  getPlayerState(): number { return this.video.ended ? 0 : this.video.paused ? 2 : 1; }
  getVideoData() { return { title: this.source.title, video_id: this.source.videoId }; }
  pauseVideo(): void { this.wantsPlayback = false; this.video.pause(); this.audio?.pause(); }
  playVideo(): void {
    if (!this.ready || this.disposed || this.failed) return;
    this.wantsPlayback = true;
    void this.video.play().catch(() => { this.wantsPlayback = false; this.audio?.pause(); });
  }
  seekTo(seconds: number): void {
    const next = Math.max(0, Math.min(seconds, this.getDuration()));
    // Finish the current decoder seek before applying the latest drag target.
    // Replacing currentTime repeatedly can prevent network-backed frames from ever settling.
    if (this.video.seeking) { this.queuedSeek = next; return; }
    this.queuedSeek = null;
    this.video.currentTime = next;
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timeout);
    this.hls?.destroy();
    this.hls = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); }
    const placeholder = document.createElement("div");
    placeholder.id = "player";
    this.video.replaceWith(placeholder);
  }
}
