import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { EOL } from "node:os";
import type { CookieStatus } from "../Shared/types";

export const MAX_COOKIE_BYTES = 1024 * 1024;

// Only retain cookies for the YouTube/Google authentication flow. Never include
// input lines (which may contain credentials) in errors or queue logs.
export function normalizeCookieFile(value: unknown, now = Date.now(), maximumBytes = MAX_COOKIE_BYTES): { contents: string; count: number } {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error("cookies.invalid");
  }
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!/^# (?:Netscape )?HTTP Cookie File\s*$/.test(lines[0])) throw new Error("cookies.invalid");
  const retained: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim() || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
    const fields = line.replace(/^#HttpOnly_/, "").split("\t");
    if (fields.length !== 7 || !/^(TRUE|FALSE)$/.test(fields[1])
      || !/^(TRUE|FALSE)$/.test(fields[3]) || !/^\d+$/.test(fields[4])
      || !fields[2].startsWith("/") || !fields[5] || /[\x00-\x08\x0b-\x1f\x7f]/.test(line)) {
      throw new Error("cookies.invalid");
    }
    const domain = fields[0].replace(/^\./, "").toLowerCase();
    if (!["youtube.com", "google.com", "youtu.be"].some((root) => domain === root || domain.endsWith(`.${root}`))) continue;
    const expires = Number(fields[4]);
    if (!Number.isSafeInteger(expires)) throw new Error("cookies.invalid");
    if (expires !== 0 && expires <= now / 1000) continue;
    retained.push(line);
  }
  if (!retained.length) throw new Error("cookies.empty");
  return { contents: ["# Netscape HTTP Cookie File", ...retained, ""].join(EOL), count: retained.length };
}

export class CookieStore {
  private readonly filename: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {
    this.filename = path.join(directory, "youtube-cookies.txt");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  private async read(): Promise<{ contents: string; count: number } | null> {
    try {
      return normalizeCookieFile(await fs.readFile(this.filename, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).message === "cookies.empty") return null;
      throw new Error("cookies.readFailed");
    }
  }

  getStatus(): Promise<CookieStatus> {
    return this.serialize(async () => {
      const data = await this.read();
      return { configured: Boolean(data), count: data?.count ?? 0 };
    });
  }

  import(contents: unknown): Promise<CookieStatus> {
    return this.importFrom(async () => contents);
  }

  importFrom(source: () => Promise<unknown>): Promise<CookieStatus> {
    return this.serialize(async () => {
      const data = normalizeCookieFile(await source());
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const staging = path.join(this.directory, `${randomUUID()}.tmp`);
      try {
        await fs.writeFile(staging, data.contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await fs.rename(staging, this.filename);
      } catch {
        throw new Error("cookies.saveFailed");
      } finally {
        await fs.rm(staging, { force: true });
      }
      return { configured: true, count: data.count };
    });
  }

  clear(): Promise<CookieStatus> {
    return this.serialize(async () => {
      await fs.rm(this.filename, { force: true });
      return { configured: false, count: 0 };
    });
  }

  // yt-dlp writes its cookie jar on exit. Give each job a private snapshot so
  // running downloads cannot overwrite a newly imported or cleared setting.
  createSnapshot(): Promise<{ path: string; dispose: () => Promise<void> } | null> {
    return this.serialize(async () => {
      const data = await this.read();
      if (!data) return null;
      const filename = path.join(this.directory, `job-${randomUUID()}.txt`);
      await fs.writeFile(filename, data.contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return { path: filename, dispose: () => fs.rm(filename, { force: true }) };
    });
  }
}
