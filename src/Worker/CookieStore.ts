import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { EOL } from "node:os";
import { isPublicWebUrl } from "../Shared/VideoSource";
import type { CookieStatus } from "../Shared/types";
import { cookieImportToNetscape, cookieSite, type CookieSite, type CookieImportData } from "../Shared/cookies";

export const MAX_COOKIE_BYTES = 1024 * 1024;

// Electron owns userData/Cookies (a SQLite file). On case-insensitive disks,
// userData/cookies is the SAME path, so it must never be used as our directory.
export async function prepareCookieDirectory(stateDirectory: string): Promise<string> {
  const directory = path.join(stateDirectory, "downloader-auth");
  await fs.mkdir(stateDirectory, { recursive: true });
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error("cookies.saveFailed");
    // Do not restore old credentials after the user clears the new store.
    return directory;
  }
  const legacy = path.join(stateDirectory, "cookies");
  try {
    if ((await fs.lstat(legacy)).isDirectory()) {
      const source = path.join(legacy, "youtube-cookies.txt");
      const info = await fs.lstat(source);
      if (info.isFile() && info.size <= MAX_COOKIE_BYTES) {
        await fs.copyFile(source, path.join(directory, "youtube-cookies.txt"), constants.COPYFILE_EXCL);
        await fs.chmod(path.join(directory, "youtube-cookies.txt"), 0o600);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return directory;
}

// Only retain cookies for the explicitly selected site's authentication flow. Never include
// input lines (which may contain credentials) in errors or queue logs.
export function normalizeCookieFile(
  value: unknown,
  now = Date.now(),
  maximumBytes = MAX_COOKIE_BYTES,
  site: CookieSite = "youtube",
): { contents: string; count: number } {
  cookieSite(site);
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new Error("cookies.invalid");
  }
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!/^# (?:Netscape )?HTTP Cookie File\s*$/.test(lines[0]))
    throw new Error("cookies.invalid");
  const retained: string[] = [];
  for (const line of lines.slice(1)) {
    if (
      !line.trim() ||
      (line.startsWith("#") && !line.startsWith("#HttpOnly_"))
    )
      continue;
    const fields = line.replace(/^#HttpOnly_/, "").split("\t");
    if (
      fields.length !== 7 ||
      !/^(TRUE|FALSE)$/.test(fields[1]) ||
      !/^(TRUE|FALSE)$/.test(fields[3]) ||
      !/^\d*$/.test(fields[4]) ||
      !fields[2].startsWith("/") ||
      !fields[5] ||
      /[\x00-\x08\x0b-\x1f\x7f]/.test(line)
    ) {
      throw new Error("cookies.invalid");
    }
    const domain = fields[0].replace(/^\./, "").toLowerCase();
    const allowed = site === "generic" ? /^[a-z0-9.-]+$/.test(domain) && isPublicWebUrl(`https://${domain}/`) : site === "youtube"
      ? ["youtube.com", "google.com", "youtu.be"].some(root => domain === root || domain.endsWith(`.${root}`))
      : domain === "chzzk.naver.com" || domain.endsWith(".chzzk.naver.com") ||
        (domain === "naver.com" && ["NID_AUT", "NID_SES"].includes(fields[5]));
    if (!allowed) continue;
    const expires = Number(fields[4]);
    if (!Number.isSafeInteger(expires)) throw new Error("cookies.invalid");
    if (expires !== 0 && expires <= now / 1000) continue;
    // Empty expiry is a valid session cookie in MozillaCookieJar exports.
    if (!fields[4]) fields[4] = "0";
    retained.push((line.startsWith("#HttpOnly_") ? "#HttpOnly_" : "") + fields.join("\t"));
  }
  if (!retained.length) throw new Error("cookies.empty");
  return {
    contents: ["# Netscape HTTP Cookie File", ...retained, ""].join(EOL),
    count: retained.length,
  };
}

export class CookieStore {
  private readonly filename: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string, private readonly site: CookieSite = "youtube") {
    this.filename = path.join(directory, `${cookieSite(site)}-cookies.txt`);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  private async read(): Promise<{ contents: string; count: number } | null> {
    try {
      return normalizeCookieFile(await fs.readFile(this.filename, "utf8"), Date.now(), MAX_COOKIE_BYTES, this.site);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as Error).message === "cookies.empty"
      )
        return null;
      throw new Error("cookies.readFailed");
    }
  }

  getStatus(): Promise<CookieStatus> {
    return this.serialize(async () => {
      try {
        const data = await this.read();
        return this.statusFor(data);
      } catch {
        return { configured: false, count: 0, error: "cookies.readFailed" };
      }
    });
  }

  private statusFor(data: { contents: string; count: number } | null): CookieStatus {
    return { configured: Boolean(data), count: data?.count ?? 0,
      ...(this.site === "chzzk" ? { loginCookiesPresent: ["NID_AUT", "NID_SES"].every(name =>
        data?.contents.split(/\r?\n/).some(line => { const fields = line.split("\t"); return fields[5] === name && Boolean(fields[6]); })) } : {}) };
  }

  // Authenticated Worker-to-main transport only; never expose this via preload.
  getPreviewContents(): Promise<string | null> {
    return this.serialize(async () => (await this.read())?.contents ?? null);
  }

  importData(data: CookieImportData): Promise<CookieStatus> {
    return this.import(cookieImportToNetscape(data));
  }

  import(contents: unknown): Promise<CookieStatus> {
    return this.importFrom(async () => contents);
  }

  importFrom(source: () => Promise<unknown>): Promise<CookieStatus> {
    return this.serialize(async () => {
      const data = normalizeCookieFile(await source(), Date.now(), MAX_COOKIE_BYTES, this.site);
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const staging = path.join(this.directory, `${randomUUID()}.tmp`);
      try {
        await fs.writeFile(staging, data.contents, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await fs.rename(staging, this.filename);
      } catch {
        throw new Error("cookies.saveFailed");
      } finally {
        await fs.rm(staging, { force: true });
      }
      return this.statusFor(data);
    });
  }

  clear(): Promise<CookieStatus> {
    return this.serialize(async () => {
      await fs.rm(this.filename, { force: true });
      return this.statusFor(null);
    });
  }

  // yt-dlp writes its cookie jar on exit. Give each job a private snapshot so
  // running downloads cannot overwrite a newly imported or cleared setting.
  createSnapshot(): Promise<{
    path: string;
    dispose: () => Promise<void>;
  } | null> {
    return this.serialize(async () => {
      const data = await this.read();
      if (!data) return null;
      const filename = path.join(this.directory, `job-${randomUUID()}.txt`);
      await fs.writeFile(filename, data.contents, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return {
        path: filename,
        dispose: () => fs.rm(filename, { force: true }),
      };
    });
  }
}
