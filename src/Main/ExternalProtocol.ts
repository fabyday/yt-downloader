export { isSupportedYouTubeUrl } from "../Shared/YouTubeSource";

export const YT_DOWNLOADER_PROTOCOL = "yt-downloader";

export interface CompanionCallbackDescriptor {
  callbackUrl: string;
  requestId: string;
  token: string;
}

export interface DownloaderDeepLinkRequest {
  companion?: CompanionCallbackDescriptor;
  sourceUrl: string;
}

export function createDownloaderDeepLink(sourceUrl: string): string {
  const deepLink = new URL(`${YT_DOWNLOADER_PROTOCOL}://open`);
  deepLink.searchParams.set("url", sourceUrl);
  return deepLink.toString();
}

export function getSourceUrlFromDeepLink(value: string): string | null {
  return parseDownloaderDeepLink(value)?.sourceUrl ?? null;
}

export function parseDownloaderDeepLink(value: string): DownloaderDeepLinkRequest | null {
  try {
    const deepLink = new URL(value);
    if (
      deepLink.protocol !== `${YT_DOWNLOADER_PROTOCOL}:` ||
      deepLink.hostname !== "open"
    ) {
      return null;
    }

    const sourceUrl = deepLink.searchParams.get("url");
    if (!sourceUrl || sourceUrl.length > 16_384 || sourceUrl.includes("\0")) {
      return null;
    }
    const requestId = deepLink.searchParams.get("requestId");
    const callbackUrl = deepLink.searchParams.get("callback");
    const token = deepLink.searchParams.get("token");
    const companion = requestId && callbackUrl && token &&
      /^[A-Za-z0-9-]{8,100}$/.test(requestId) &&
      token.length >= 32 && token.length <= 256 &&
      isLoopbackCallbackUrl(callbackUrl)
      ? { callbackUrl, requestId, token }
      : undefined;
    return { sourceUrl, ...(companion ? { companion } : {}) };
  } catch {
    return null;
  }
}

function isLoopbackCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
      !url.username && !url.password && Boolean(url.port);
  } catch {
    return false;
  }
}

export function findDownloaderDeepLink(values: readonly string[]): string | null {
  return (
    values.find((value) => value.startsWith(`${YT_DOWNLOADER_PROTOCOL}://`)) ??
    null
  );
}
