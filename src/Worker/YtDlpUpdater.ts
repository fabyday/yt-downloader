import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { MIN_YT_DLP_VERSION, YT_DLP_UPDATE_TIMEOUT_MS } from "../Shared/dependencies";

export { YT_DLP_UPDATE_TIMEOUT_MS } from "../Shared/dependencies";
const RELEASE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const MAX_BINARY_BYTES = 150 * 1024 * 1024;
const execute = promisify(execFile);

interface UpdateOptions {
  directory: string;
  fallbackPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  getVersion?: (command: string) => Promise<string | null>;
  log?: (message: string) => void;
  onSelected?: (command: string, version: string | null) => void;
}

interface Release {
  tag_name?: unknown;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string }>;
}

// Let a working binary serve downloads while a newer release installs in the
// background. Only a missing/outdated installation has to wait for the update.
export function prepareYtDlpOnStartup(options: UpdateOptions): {
  getPath: () => Promise<string>;
  finished: Promise<string>;
} {
  let currentPath = options.fallbackPath;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const finished = updateYtDlpOnStartup({
    ...options,
    onSelected: (command, version) => {
      currentPath = command;
      if (version && compareVersions(version, MIN_YT_DLP_VERSION) >= 0) resolveReady();
    },
  }).then((command) => {
    currentPath = command;
    resolveReady();
    return command;
  });
  return { getPath: async () => { await ready; return currentPath; }, finished };
}

// Install outside the signed/read-only app bundle. Immutable version paths also
// avoid replacing a running Windows executable or an active download's binary.
export async function updateYtDlpOnStartup(options: UpdateOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const spec = getAsset(platform, arch);
  const log = options.log ?? ((message) => console.error(`[yt-dlp update] ${message}`));
  const request = options.fetch ?? fetch;
  let selectedPath = options.fallbackPath;
  let selectedVersion: string | null = null;
  let stagingDirectory: string | null = null;
  if (!spec) return selectedPath;

  const signal = AbortSignal.any([
    AbortSignal.timeout(YT_DLP_UPDATE_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  const getVersion = options.getVersion ?? ((command) => readExecutableVersion(command, signal));
  try {
    selectedVersion = await getVersion(selectedPath);
    await fs.mkdir(options.directory, { recursive: true });
    const suffix = `-${platform}-${arch}-`;
    const cached = (await fs.readdir(options.directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{2}\.\d{2}-/.test(entry.name)
        && entry.name.slice(10).startsWith(suffix))
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of cached) {
      signal.throwIfAborted();
      const version = entry.name.slice(0, 10);
      if (selectedVersion && compareVersions(version, selectedVersion) <= 0) break;
      const candidate = path.join(options.directory, entry.name, spec.executable);
      if (await getVersion(candidate) === version) {
        selectedPath = candidate;
        selectedVersion = version;
        break;
      }
    }

    options.onSelected?.(selectedPath, selectedVersion);

    log("Checking the latest official stable release");
    const response = await request(RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "YT-Section-Downloader" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    const release = JSON.parse((await readLimited(response, 2 * 1024 * 1024)).toString("utf8")) as Release;
    const latest = typeof release.tag_name === "string" && /^\d{4}\.\d{2}\.\d{2}$/.test(release.tag_name)
      ? release.tag_name : null;
    if (!latest || release.draft || release.prerelease) throw new Error("Invalid stable release metadata");
    if (selectedVersion && compareVersions(latest, selectedVersion) <= 0) {
      log(`Using ${selectedVersion}`);
      return selectedPath;
    }
    if (!Array.isArray(release.assets)
      || !release.assets.some((asset) => asset.name === spec.asset)
      || !release.assets.some((asset) => asset.name === "SHA2-256SUMS")) {
      throw new Error(`The release has no verified binary for ${platform}/${arch}`);
    }

    // Derive download URLs from the official repo, not arbitrary metadata URLs.
    const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${latest}`;
    const checksumResponse = await request(`${base}/SHA2-256SUMS`, { signal });
    const checksums = (await readLimited(checksumResponse, 1024 * 1024)).toString("utf8");
    const expectedHash = checksums.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
      .find((fields) => fields[1]?.replace(/^\*/, "") === spec.asset)?.[0];
    if (!expectedHash || !/^[a-f\d]{64}$/i.test(expectedHash)) throw new Error("Missing SHA-256 checksum");

    stagingDirectory = await fs.mkdtemp(path.join(options.directory, ".update-"));
    const stagedPath = path.join(stagingDirectory, spec.executable);
    log(`Downloading ${latest}`);
    const binaryResponse = await request(`${base}/${spec.asset}`, { signal });
    assertResponse(binaryResponse, MAX_BINARY_BYTES);
    const hash = createHash("sha256");
    let bytes = 0;
    let loggedBytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_BINARY_BYTES) return callback(new Error("Binary download exceeds the size limit"));
        hash.update(chunk);
        if (bytes - loggedBytes >= 5 * 1024 * 1024) {
          loggedBytes = bytes;
          log(`Downloaded ${Math.floor(bytes / (1024 * 1024))} MiB of ${latest}`);
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(binaryResponse.body as unknown as ReadableStream<Uint8Array>),
      verifier,
      createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    if (hash.digest("hex") !== expectedHash.toLowerCase()) throw new Error("SHA-256 checksum mismatch");
    await fs.chmod(stagedPath, 0o755);
    if (await getVersion(stagedPath) !== latest) throw new Error("Downloaded executable version check failed");
    signal.throwIfAborted();
    const installedDirectory = path.join(options.directory, `${latest}${suffix}${randomUUID()}`);
    await fs.rename(stagingDirectory, installedDirectory);
    stagingDirectory = null;
    selectedPath = path.join(installedDirectory, spec.executable);
    log(`Installed ${latest}`);
  } catch (error) {
    log(`Update unavailable; using ${selectedVersion ?? "the existing binary"}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (stagingDirectory) await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
  return selectedPath;
}

function getAsset(platform: NodeJS.Platform, arch: string): { asset: string; executable: string } | null {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    return { asset: "yt-dlp_macos", executable: "yt-dlp" };
  }
  if (platform === "win32") {
    const assets: Record<string, string> = { x64: "yt-dlp.exe", arm64: "yt-dlp_arm64.exe", ia32: "yt-dlp_x86.exe" };
    if (assets[arch]) return { asset: assets[arch], executable: "yt-dlp.exe" };
  }
  return null;
}

async function readExecutableVersion(command: string, signal: AbortSignal): Promise<string | null> {
  try {
    const { stdout } = await execute(command, ["--version"], {
      timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true, signal,
    });
    return stdout.trim().match(/^\d{4}\.\d{2}\.\d{2}(?=\s|\.|$)/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function compareVersions(left: string, right: string): number {
  return Number(left.replaceAll(".", "")) - Number(right.replaceAll(".", ""));
}

function assertResponse(response: Response, limit: number): void {
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  if (!response.body) throw new Error("GitHub returned an empty body");
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Response exceeds the size limit");
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  assertResponse(response, limit);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error("Response exceeds the size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
