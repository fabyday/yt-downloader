export type CookieSite = "youtube" | "chzzk" | "generic";
export function cookieSite(value: unknown): CookieSite {
  if (value === undefined || value === "youtube") return "youtube";
  if (value === "chzzk") return "chzzk";
  if (value === "generic") return "generic";
  throw new Error("cookies.invalidSite");
}
export const COOKIE_BROWSERS = ["chrome", "edge", "firefox", "brave", "chromium", "opera", "vivaldi", "safari"] as const;
export type CookieBrowser = typeof COOKIE_BROWSERS[number];
export interface BrowserCookieOptions {
  site?: CookieSite;
  browser: CookieBrowser;
  profile?: string;
}
export const COOKIE_IMPORT_TIMEOUT_MS = 90_000;

export interface BrowserProcessStatus { running: boolean; }
export interface BrowserProfileList {
  supported: boolean;
  profiles: Array<{ value: string; label: string }>;
  error?: "cookies.profilesFailed";
}

/** Provider-neutral input for file, browser and future Kawaikara adapters. */
export type CookieImportData = { format: "netscape"; contents: string } | {
  format: "records";
  cookies: Array<{ domain: string; path?: string; name: string; value: string;
    secure?: boolean; httpOnly?: boolean; expirationDate?: number; }>;
};

export function cookieImportToNetscape(data: CookieImportData): string {
  if (data?.format === "netscape" && typeof data.contents === "string") return data.contents;
  if (data?.format !== "records" || !Array.isArray(data.cookies) || data.cookies.length > 10000) throw new Error("cookies.invalid");
  const rows = data.cookies.map(cookie => {
    if (!cookie || [cookie.domain, cookie.path ?? "/", cookie.name, cookie.value]
      .some(value => typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) ||
      !cookie.domain || !cookie.name || !/^(?:\.?[a-zA-Z0-9-]+)+(?:\.[a-zA-Z0-9-]+)*$/.test(cookie.domain) ||
      (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate < -1))) throw new Error("cookies.invalid");
    return [(cookie.httpOnly ? "#HttpOnly_" : "") + cookie.domain,
      cookie.domain.startsWith(".") ? "TRUE" : "FALSE", cookie.path ?? "/",
      cookie.secure ? "TRUE" : "FALSE", Math.max(0, Math.floor(cookie.expirationDate ?? 0)), cookie.name, cookie.value].join("\t");
  });
  return ["# Netscape HTTP Cookie File", ...rows, ""].join("\n");
}

export function browserCookieSpec(value: BrowserCookieOptions): string {
  cookieSite(value?.site);
  // Generic credentials are explicitly imported as a file; never retain an entire browser jar.
  if (value?.site === "generic") throw new Error("cookies.genericFileOnly");
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
