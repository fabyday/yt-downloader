import type { YtClipperApi } from "../Shared/types";

declare global {
  interface YouTubePlayer {
    cueVideoById(videoId: string): void;
    loadVideoById(videoId: string): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    getVideoData(): { title?: string; video_id?: string };
    pauseVideo(): void;
    playVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
  }

  interface YouTubePlayerOptions {
    videoId: string;
    width: string;
    height: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady(): void;
      onStateChange(): void;
    };
  }

  interface YouTubeNamespace {
    Player: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer;
    PlayerState: {
      PLAYING: number;
    };
  }

  interface Window {
    ytClipper: YtClipperApi;
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};
