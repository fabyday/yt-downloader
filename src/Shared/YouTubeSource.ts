const SOURCE_URL_MAX_LENGTH = 16_384;

/** Determines whether YT Downloader can interpret a source as a YouTube video. */
export function isSupportedYouTubeUrl(value: string): boolean {
  if (!value || value.length > SOURCE_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (hostname === "youtu.be") return segments.length >= 1;
    if (![
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
    ].includes(hostname)) return false;
    if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
    if (hostname === "music.youtube.com") return false;
    return (
      ["embed", "shorts", "live"].includes(segments[0]) &&
      Boolean(segments[1])
    );
  } catch {
    return false;
  }
}
