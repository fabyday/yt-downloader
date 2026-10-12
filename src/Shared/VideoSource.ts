import { isSupportedYouTubeUrl } from "./YouTubeSource";

export type VideoSite = "youtube" | "chzzk";
export interface VideoSource { site: VideoSite; id: string; key: string; url: string; }

/** Explicit source allowlist; never pass arbitrary/local URLs to extractors. */
export function parseVideoSource(value: string): VideoSource | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "chzzk.naver.com") {
      const match = /^\/video\/(\d+)\/?$/.exec(url.pathname);
      return match ? { site: "chzzk", id: match[1], key: `chzzk:${match[1]}`, url: `https://chzzk.naver.com/video/${match[1]}` } : null;
    }
    if (!isSupportedYouTubeUrl(value.trim())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.hostname === "youtu.be" ? parts[0] : url.pathname === "/watch" ? url.searchParams.get("v") : parts[1];
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return { site: "youtube", id, key: id, url: `https://www.youtube.com/watch?v=${id}` };
  } catch { return null; }
}

export function previewSource(key: unknown): VideoSource | null {
  if (typeof key !== "string") return null;
  if (/^chzzk:\d+$/.test(key)) return parseVideoSource(`https://chzzk.naver.com/video/${key.slice(6)}`);
  return /^[\w-]{11}$/.test(key) ? parseVideoSource(`https://www.youtube.com/watch?v=${key}`) : null;
}

export function isChzzkLiveUrl(value: string): boolean {
  try { const url = new URL(value); return url.hostname === "chzzk.naver.com" && /^\/live\/[a-f0-9]+\/?$/.test(url.pathname); }
  catch { return false; }
}

/** Also used for every HLS subrequest, not only the initial playlist. */
export function isPreviewMediaUrl(value: string, site: VideoSite): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return site === "youtube"
      ? url.hostname.endsWith(".googlevideo.com") || url.hostname.endsWith(".c.youtube.com")
      : url.hostname.endsWith(".pstatic.net") || url.hostname === "apis.naver.com";
  } catch { return false; }
}
