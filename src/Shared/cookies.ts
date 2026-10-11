export const COOKIE_BROWSERS = ["chrome", "edge", "firefox", "brave", "chromium", "opera", "vivaldi", "safari"] as const;
export type CookieBrowser = typeof COOKIE_BROWSERS[number];
export interface BrowserCookieOptions {
  browser: CookieBrowser;
  profile?: string;
}
export const COOKIE_IMPORT_TIMEOUT_MS = 90_000;

export function browserCookieSpec(value: BrowserCookieOptions): string {
  if (!value || !COOKIE_BROWSERS.includes(value.browser)) throw new Error("cookies.invalidBrowser");
  if (value.profile !== undefined && typeof value.profile !== "string") throw new Error("cookies.invalidProfile");
  const profile = value.profile?.trim() ?? "";
  // Accept profile names, not paths, keyring arguments, or containers.
  if (profile.length > 100 || (profile && !/^[a-zA-Z0-9_ .-]+$/.test(profile))
    || profile === "." || profile === ".." || (value.browser === "safari" && profile)) {
    throw new Error("cookies.invalidProfile");
  }
  return profile ? `${value.browser}:${profile}` : value.browser;
}
