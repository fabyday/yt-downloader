import type { YtClipperApi } from "../Shared/types";

declare global {
  interface PreviewPlayer {
    destroy(): void;
    getCurrentTime(): number;
    isSeeking(): boolean;
    setVolume(volume: number, muted: boolean): void;
    getDuration(): number;
    getPlayerState(): number;
    getVideoData(): { title?: string; video_id?: string };
    pauseVideo(): void;
    playVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
  }

  interface Window {
    ytClipper: YtClipperApi;
  }
}

export {};
