import { isSupportedYouTubeUrl } from "./YouTubeSource";

export type VideoSite = "youtube" | "chzzk" | "generic";
export interface VideoSource { site: VideoSite; id: string; key: string; url: string; }

/** Public web addresses only. This is input validation, not a DNS/network sandbox. */
export function isPublicWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port &&
      host.includes(".") && !host.includes(":") && !/^[\d.]+$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host);
  } catch { return false; }
}

/** Let the installed yt-dlp choose an extractor instead of freezing its site list here. */
export function parseVideoSource(value: string): VideoSource | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value.trim());
    if (!isPublicWebUrl(value.trim())) return null;
    if (url.protocol === "https:" && url.hostname === "chzzk.naver.com") {
      const match = /^\/video\/(\d+)\/?$/.exec(url.pathname);
      if (match) return { site: "chzzk", id: match[1], key: `chzzk:${match[1]}`, url: `https://chzzk.naver.com/video/${match[1]}` };
      if (isChzzkLiveUrl(value)) return null;
    }
    if (!isSupportedYouTubeUrl(value.trim())) {
      return { site: "generic", id: url.hostname, key: `web:${url.href}`, url: url.href };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.hostname === "youtu.be" ? parts[0] : url.pathname === "/watch" ? url.searchParams.get("v") : parts[1];
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return { site: "youtube", id, key: id, url: `https://www.youtube.com/watch?v=${id}` };
  } catch { return null; }
}

export function previewSource(key: unknown): VideoSource | null {
  if (typeof key !== "string") return null;
  if (key.startsWith("web:")) {
    const source = parseVideoSource(key.slice(4));
    return source?.site === "generic" ? source : null;
  }
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
    if (site === "generic") return isPublicWebUrl(value);
    return site === "youtube"
      ? url.hostname.endsWith(".googlevideo.com") || url.hostname.endsWith(".c.youtube.com")
      : url.hostname.endsWith(".pstatic.net") || url.hostname === "apis.naver.com";
  } catch { return false; }
}
