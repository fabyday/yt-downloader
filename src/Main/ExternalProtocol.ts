export { isSupportedYouTubeUrl } from "../Shared/YouTubeSource";

export const YT_DOWNLOADER_PROTOCOL = "yt-downloader";

export function createDownloaderDeepLink(sourceUrl: string): string {
  const deepLink = new URL(`${YT_DOWNLOADER_PROTOCOL}://open`);
  deepLink.searchParams.set("url", sourceUrl);
  return deepLink.toString();
}

export function getSourceUrlFromDeepLink(value: string): string | null {
  try {
    const deepLink = new URL(value);
    if (
      deepLink.protocol !== `${YT_DOWNLOADER_PROTOCOL}:` ||
      deepLink.hostname !== "open"
    ) {
      return null;
    }

    const sourceUrl = deepLink.searchParams.get("url");
    return sourceUrl && sourceUrl.length <= 16_384 && !sourceUrl.includes("\0")
      ? sourceUrl
      : null;
  } catch {
    return null;
  }
}

export function findDownloaderDeepLink(values: readonly string[]): string | null {
  return (
    values.find((value) => value.startsWith(`${YT_DOWNLOADER_PROTOCOL}://`)) ??
    null
  );
}
