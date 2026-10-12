import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { browserCookieSpec, type BrowserCookieOptions, type BrowserProfileList, type CookieBrowser } from "../Shared/cookies";

interface ProfileEnvironment { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; }

// Match yt-dlp's standard profile roots. Discovery uses profile metadata only;
// it never opens Cookies databases, decrypts keys, or starts a browser.
export function browserProfileRoots(browser: CookieBrowser, context: ProfileEnvironment): string[] {
  const { platform, home, env } = context;
  if (browser === "safari" || browser === "opera") return [];
  const p = platform === "win32" ? path.win32 : path.posix;
  if (browser === "firefox") {
    if (platform === "darwin") return [p.join(home, "Library/Application Support/Firefox/Profiles")];
    if (platform === "win32") return [
      p.join(env.APPDATA || p.join(home, "AppData/Roaming"), "Mozilla/Firefox/Profiles"),
      p.join(env.LOCALAPPDATA || p.join(home, "AppData/Local"), "Packages/Mozilla.Firefox_n80bbvh6b1yt2/LocalCache/Roaming/Mozilla/Firefox/Profiles"),
    ];
    return [p.join(env.XDG_CONFIG_HOME || p.join(home, ".config"), "mozilla/firefox"),
      p.join(home, ".mozilla/firefox"), p.join(home, ".var/app/org.mozilla.firefox/config/mozilla/firefox"),
      p.join(home, ".var/app/org.mozilla.firefox/.mozilla/firefox"), p.join(home, "snap/firefox/common/.mozilla/firefox")];
  }
  const directories = {
    chrome: ["Google/Chrome/User Data", "Google/Chrome", "google-chrome"],
    edge: ["Microsoft/Edge/User Data", "Microsoft Edge", "microsoft-edge"],
    brave: ["BraveSoftware/Brave-Browser/User Data", "BraveSoftware/Brave-Browser", "BraveSoftware/Brave-Browser"],
    chromium: ["Chromium/User Data", "Chromium", "chromium"],
    vivaldi: ["Vivaldi/User Data", "Vivaldi", "vivaldi"],
  }[browser];
  return [platform === "win32" ? p.join(env.LOCALAPPDATA || p.join(home, "AppData/Local"), directories[0])
    : platform === "darwin" ? p.join(home, "Library/Application Support", directories[1])
    : p.join(env.XDG_CONFIG_HOME || p.join(home, ".config"), directories[2])];
}

async function readMetadata(file: string): Promise<string | null> {
  try {
    const handle = await fs.open(file, "r");
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error("metadata too large");
      return await handle.readFile("utf8");
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function listBrowserProfiles(options: BrowserCookieOptions, context: ProfileEnvironment = {
  platform: process.platform, home: os.homedir(), env: process.env,
}): Promise<BrowserProfileList> {
  browserCookieSpec({ browser: options?.browser });
  const roots = browserProfileRoots(options.browser, context);
  const result: BrowserProfileList = { supported: roots.length > 0, profiles: [] };
  const names = new Map<string, string>();
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const labels = new Map<string, string>();
      if (options.browser === "firefox") {
        const ini = await readMetadata(path.join(root, context.platform === "linux" ? "profiles.ini" : "../profiles.ini"));
        for (const section of (ini ?? "").split(/\r?\n\[/)) {
          const fields = Object.fromEntries(section.split(/\r?\n/).filter(line => line.includes("=")).map(line => {
            const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
          }));
          if (fields.Path && fields.Name) labels.set(path.basename(fields.Path.replace(/\\/g, "/")), fields.Name);
        }
      } else {
        const text = await readMetadata(path.join(root, "Local State"));
        const info = text ? JSON.parse(text)?.profile?.info_cache : null;
        if (info && typeof info === "object") for (const [folder, metadata] of Object.entries(info)) {
          const name = (metadata as { name?: unknown } | null)?.name;
          if (typeof name === "string") labels.set(folder, name);
        }
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue; // do not traverse symlinks
        try { browserCookieSpec({ browser: options.browser, profile: entry.name }); } catch { continue; }
        if (options.browser === "firefox") {
          try { if (!(await fs.stat(path.join(root, entry.name, "cookies.sqlite"))).isFile()) continue; }
          catch { continue; }
        } else if (!labels.has(entry.name) && !/^(Default|Profile \d+)$/.test(entry.name)) continue;
        const label = (labels.get(entry.name) ?? entry.name).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);
        names.set(entry.name, label === entry.name ? label : `${label} (${entry.name})`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.error = "cookies.profilesFailed";
    }
  }
  result.profiles = [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
  return result;
}
