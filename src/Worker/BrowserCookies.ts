import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { browserCookieSpec, COOKIE_IMPORT_TIMEOUT_MS, type BrowserCookieOptions } from "../Shared/cookies";
import { normalizeCookieFile, MAX_COOKIE_BYTES } from "./CookieStore";

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

// Some yt-dlp versions export Chromium's expires_utc unchanged: microseconds
// since 1601, not Netscape's Unix seconds. Convert only Chromium browser exports,
// using BigInt before any Number conversion loses precision. Already-converted
// Unix timestamps and session cookies are left alone.
export function normalizeBrowserCookieExpiry(contents: string, browser: BrowserCookieOptions["browser"]): string {
  if (browser === "firefox" || browser === "safari") return contents;
  return contents.split(/\r?\n/).flatMap(line => {
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) return [line];
    const fields = line.split("\t");
    if (fields.length !== 7 || !/^\d{16,19}$/.test(fields[4])) return [line];
    const raw = BigInt(fields[4]);
    if (raw <= BigInt(Number.MAX_SAFE_INTEGER) || raw > 9223372036854775807n) return [line];
    const seconds = raw / 1_000_000n - 11_644_473_600n;
    // A pre-Unix-epoch expiry is expired, never a session cookie (0).
    if (seconds <= 0n) return [];
    fields[4] = seconds.toString();
    return [fields.join("\t")];
  }).join("\n");
}
interface ExportOptions {
  browser: BrowserCookieOptions;
  command: string;
  directory: string;
  signal?: AbortSignal;
  run?: (command: string, args: string[], signal: AbortSignal) => Promise<{ code: number; stderr: string }>;
}

// No video URL is supplied: this extracts locally and does not log cookie data.
// yt-dlp exports all domains; filter immediately and remove the temporary jar.
export async function exportBrowserCookies(options: ExportOptions): Promise<string> {
  const spec = browserCookieSpec(options.browser);
  const signal = AbortSignal.any([
    AbortSignal.timeout(COOKIE_IMPORT_TIMEOUT_MS), ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(options.directory, "browser-import-"));
  const filename = path.join(directory, "cookies.txt");
  try {
    await fs.writeFile(filename, "# Netscape HTTP Cookie File\n", { mode: 0o600, flag: "wx" });
    const result = await (options.run ?? runExport)(options.command, [
      "--ignore-config", "--no-plugin-dirs", "--no-cache-dir",
      "--cookies-from-browser", spec, "--cookies", filename,
    ], signal);
    if (/find-generic-password.*(?:failed|error)|(?:keychain|keyring).*(?:error|failed|denied)|(?:failed|unable) to (?:read|retrieve).*(?:keychain|keyring)/i.test(result.stderr)) throw new Error("cookies.keychainAccessFailed");
    if (/operation not permitted|permission denied|access is denied/i.test(result.stderr)) throw new Error("cookies.permissionDenied");
    if (/failed to decrypt|could not decrypt|cannot decrypt|could not be decrypted|DPAPI|app.bound/i.test(result.stderr)) throw new Error("cookies.decryptFailed");
    if (/could not copy|database.*locked|being used by another process/i.test(result.stderr)) throw new Error("cookies.browserLocked");
    if (/could not find|no such file|does not exist/i.test(result.stderr)) throw new Error("cookies.browserMissing");
    // CLI-only export completes the jar when its context exits, but reports
    // missing URL (exit 2). Accept only that documented no-download outcome.
    if (result.code !== 0 && !(result.code === 2 && /must provide at least one URL/i.test(result.stderr))) {
      throw new Error("cookies.browserFailed");
    }
    signal.throwIfAborted();
    const file = await fs.open(filename, "r");
    let contents: string;
    try {
      if ((await file.stat()).size > MAX_EXPORT_BYTES) throw new Error("cookies.browserFailed");
      contents = await file.readFile("utf8");
    } finally {
      await file.close();
    }
    const resultFile = normalizeCookieFile(normalizeBrowserCookieExpiry(contents, options.browser.browser), Date.now(), MAX_EXPORT_BYTES, options.browser.site);
    if (Buffer.byteLength(resultFile.contents, "utf8") > MAX_COOKIE_BYTES) throw new Error("cookies.invalid");
    return resultFile.contents;
  } catch (error) {
    if (signal.aborted) throw new Error("cookies.browserTimeout");
    const message = error instanceof Error ? error.message : "";
    if (/^cookies\.[a-zA-Z]+$/.test(message)) throw error;
    throw new Error("cookies.browserFailed");
  } finally {
    await fs.rm(filename, { force: true });
    await fs.rmdir(directory);
  }
}

async function runExport(command: string, args: string[], signal: AbortSignal): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    let result: { code: number; stderr: string } | undefined;
    const child = execFile(command, args, { signal, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) result = { code: 0, stderr };
        else if (typeof error.code === "number") result = { code: error.code, stderr };
      });
    // On abort, execFile's callback can run before the process has released
    // its file handles. Wait for close before removing its temporary jar.
    child.once("close", () => {
      if (result) resolve(result);
      else reject(new Error("cookies.browserFailed"));
    });
  });
}
