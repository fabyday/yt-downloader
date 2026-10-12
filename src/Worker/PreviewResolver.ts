import { execFile } from "node:child_process";
import type { PreviewResult } from "../Shared/types";
import { isPreviewMediaUrl, previewSource } from "../Shared/VideoSource";
import { ytDlpSiteArgs } from "./YtDlpPlugins";

interface PreviewOptions {
  command: string;
  nodeRuntimePath: string;
  cookiePath?: string;
  signal?: AbortSignal;
}

export function previewFailure(stderr: string): PreviewResult {
  if (/cookies.*(?:no longer valid|expired|rotated)|expired cookies/i.test(stderr)) return { ok: false, error: "preview.expired" };
  if (/private video|sign in|login required|members.only|not available.*account|HTTP Error 40[13]|성인|로그인|연령|구독자/i.test(stderr)) return { ok: false, error: "preview.denied" };
  return { ok: false, error: "preview.failed" };
}

export function selectPreview(info: any, videoId: string): PreviewResult {
  const site = videoId.startsWith("chzzk:") ? "chzzk" : "youtube";
  if (info?.is_live || info?.live_status === "is_live") return { ok: false, error: "preview.liveUnsupported" };
  // HTTPS streams let Chromium seek without downloading the whole video.
  // Do not expose cookies, request headers, manifests or arbitrary extractor URLs.
  const candidates = (Array.isArray(info?.formats) ? info.formats : []).filter((format: any) => {
    if (format.protocol !== "https" || format.has_drm) return false;
    return isPreviewMediaUrl(format.url, site);
  }).sort((a: any, b: any) => (a.height ?? 0) - (b.height ?? 0));
  const videos = candidates.filter((format: any) => /^avc1/.test(format.vcodec ?? "") && format.ext === "mp4");
  const muxed = videos.filter((format: any) => /^mp4a/.test(format.acodec ?? ""));
  const selected = muxed.filter((format: any) => format.height <= 720).at(-1) ?? muxed[0] ??
    videos.filter((format: any) => format.acodec === "none" && format.height <= 720).at(-1);
  if (!selected && site === "chzzk") {
    const hls = (Array.isArray(info?.formats) ? info.formats : []).filter((format: any) =>
      !format.has_drm && /^m3u8(?:_native)?$/.test(format.protocol ?? "") &&
      /^avc1/.test(format.vcodec ?? "") && /^mp4a/.test(format.acodec ?? "") &&
      isPreviewMediaUrl(format.url, site)).sort((a: any, b: any) => (a.height ?? 0) - (b.height ?? 0));
    const stream = hls.filter((format: any) => format.height <= 720).at(-1) ?? hls[0];
    if (stream) return { ok: true, url: stream.url, transport: "hls", videoId,
      title: typeof info.title === "string" ? info.title : "", duration: Number(info.duration) || undefined };
  }
  if (!selected) return { ok: false, error: "preview.unavailable" };
  const audio = candidates.filter((format: any) => format.vcodec === "none" && /^mp4a/.test(format.acodec ?? ""))
    .sort((a: any, b: any) => (a.abr ?? 0) - (b.abr ?? 0)).at(-1);
  if (selected.acodec === "none" && !audio) return { ok: false, error: "preview.unavailable" };
  return { ok: true, url: selected.url, ...(selected.acodec === "none" ? { audioUrl: audio.url } : {}),
    title: typeof info.title === "string" ? info.title : "", videoId };
}

export async function resolvePreview(videoId: string, options: PreviewOptions): Promise<PreviewResult> {
  const source = previewSource(videoId);
  if (!source) return { ok: false, error: "preview.failed" };
  return new Promise(resolve => {
    execFile(options.command, ["--ignore-config", "--no-playlist", "--no-cache-dir", "--skip-download",
      ...ytDlpSiteArgs(source.url),
      "--dump-single-json", "--socket-timeout", "15", "--retries", "1", "--extractor-retries", "1",
      "--no-js-runtimes", "--js-runtimes", `node:${options.nodeRuntimePath}`,
      ...(options.cookiePath ? ["--cookies", options.cookiePath] : []),
      source.url], {
      timeout: 70_000, maxBuffer: 16 * 1024 * 1024, signal: options.signal,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }, (error, stdout, stderr) => {
      // Never propagate child errors: they can contain cookie paths and signed URLs.
      if (error) { resolve(previewFailure(stderr)); return; }
      try { resolve(selectPreview(JSON.parse(stdout), videoId)); }
      catch { resolve({ ok: false, error: "preview.failed" }); }
    });
  });
}
