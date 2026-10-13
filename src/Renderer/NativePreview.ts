import type { PreviewResult } from "../Shared/types";
import { isPreviewMediaUrl } from "../Shared/VideoSource";
import type Hls from "hls.js";

export class NativePreview implements YouTubePlayer {
  private readonly video = document.createElement("video");
  private readonly audio: HTMLAudioElement | null;
  private readonly timeout: number;
  private disposed = false;
  private failed = false;
  private ready = false;
  private framePresented = false;
  private wantsPlayback = false;
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
      this.video.muted = false;
      clearTimeout(this.timeout);
      onReady();
    };
    this.video.addEventListener("loadeddata", checkReady);
    this.video.requestVideoFrameCallback(() => {
      if (this.disposed || this.failed) return;
      this.framePresented = this.video.videoWidth > 0 && this.video.videoHeight > 0;
      checkReady();
    });
    this.video.addEventListener("error", fail);
    this.video.addEventListener("waiting", () => this.audio?.pause());
    this.video.addEventListener("playing", () => {
      if (!this.audio || this.disposed || !this.ready || !this.wantsPlayback || this.video.paused) return;
      this.audio.currentTime = this.video.currentTime;
      void this.audio.play().catch(fail);
    });
    this.video.addEventListener("timeupdate", () => {
      if (this.audio && !this.video.paused && Math.abs(this.audio.currentTime - this.video.currentTime) > 0.2) {
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
  getCurrentTime(): number { return this.video.currentTime; }
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
    this.video.currentTime = Math.max(0, Math.min(seconds, this.getDuration()));
    if (this.audio) this.audio.currentTime = this.video.currentTime;
  }
  // The controller recreates this adapter on source changes.
  cueVideoById(): void {}
  loadVideoById(): void {}
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
