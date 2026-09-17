const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { updateYtDlpOnStartup, prepareYtDlpOnStartup } = require("../src/Worker/YtDlpUpdater.ts");

const releaseUrl = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const latest = "2026.08.19";
const binary = Buffer.from(`test executable ${latest}`);
const checksum = createHash("sha256").update(binary).digest("hex");

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yt-updater-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fallbackPath = path.join(directory, "bundled-yt-dlp");
  await fs.writeFile(fallbackPath, "2026.07.04");
  const calls = [];
  const logs = [];
  const options = {
    directory: path.join(directory, "cache"), fallbackPath, platform: "darwin", arch: "arm64",
    log: (message) => logs.push(message),
    getVersion: async (command) => {
      try { return (await fs.readFile(command, "utf8")).match(/\d{4}\.\d{2}\.\d{2}/)?.[0] ?? null; }
      catch { return null; }
    },
    fetch: async (url, init) => {
      calls.push(url);
      init.signal.throwIfAborted();
      if (url === releaseUrl) return Response.json({ tag_name: latest, assets: [{ name: "yt-dlp_macos" }, { name: "SHA2-256SUMS" }] });
      if (url.endsWith("/SHA2-256SUMS")) return new Response(`${checksum}  yt-dlp_macos\n`);
      if (url.endsWith("/yt-dlp_macos")) return new Response(binary);
      throw new Error(`Unexpected URL ${url}`);
    },
    ...overrides,
  };
  return { options, calls, logs, directory };
}

test("downloads, verifies, and atomically installs into the user cache without touching the bundle", async (t) => {
  const { options, calls } = await fixture(t);
  const installed = await updateYtDlpOnStartup(options);
  assert.notEqual(installed, options.fallbackPath);
  assert.equal(path.dirname(path.dirname(installed)), options.directory);
  assert.deepEqual(await fs.readFile(installed), binary);
  assert.equal(await fs.readFile(options.fallbackPath, "utf8"), "2026.07.04");
  assert.equal((await fs.stat(installed)).mode & 0o777, 0o755);
  assert.equal((await fs.readdir(options.directory)).length, 1);
  assert.deepEqual(calls, [releaseUrl,
    `https://github.com/yt-dlp/yt-dlp/releases/download/${latest}/SHA2-256SUMS`,
    `https://github.com/yt-dlp/yt-dlp/releases/download/${latest}/yt-dlp_macos`]);
});

test("checks on every startup but does not re-download an installed current release", async (t) => {
  const { options, calls } = await fixture(t);
  const installed = await updateYtDlpOnStartup(options);
  calls.length = 0;
  assert.equal(await updateYtDlpOnStartup(options), installed);
  assert.deepEqual(calls, [releaseUrl]);
});

test("offline startup selects the newest working cache, skipping broken and foreign-architecture caches", async (t) => {
  const { options, logs } = await fixture(t, { fetch: async () => { throw new Error("offline"); } });
  for (const [name, contents] of [
    [`${latest}-darwin-arm64-valid`, latest],
    ["2026.09.01-darwin-arm64-broken", "invalid executable"],
    ["2026.09.02-win32-arm64-foreign", "2026.09.02"],
    ["2026.09.03-darwin-x64-foreign", "2026.09.03"],
  ]) {
    await fs.mkdir(path.join(options.directory, name), { recursive: true });
    await fs.writeFile(path.join(options.directory, name, "yt-dlp"), contents);
  }
  assert.equal(await updateYtDlpOnStartup(options), path.join(options.directory, `${latest}-darwin-arm64-valid`, "yt-dlp"));
  assert.match(logs.at(-1), /offline/);
});

test("network and rate-limit failures fall back without breaking startup", async (t) => {
  const { options } = await fixture(t, { fetch: async () => new Response("rate limited", { status: 403 }) });
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
});

test("a newer bundled binary is not downgraded", async (t) => {
  const { options, calls } = await fixture(t);
  await fs.writeFile(options.fallbackPath, "2026.09.17");
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  assert.deepEqual(calls, [releaseUrl]);
});

test("checksum mismatch is rejected before executing the download and temporary files are removed", async (t) => {
  const { options, logs } = await fixture(t);
  const originalFetch = options.fetch;
  const originalVersion = options.getVersion;
  let executedDownload = false;
  options.getVersion = async (command) => {
    if (command.includes(".update-")) executedDownload = true;
    return originalVersion(command);
  };
  options.fetch = async (url, init) => url.endsWith("/yt-dlp_macos")
    ? new Response("tampered") : originalFetch(url, init);
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  assert.equal(executedDownload, false);
  assert.deepEqual(await fs.readdir(options.directory), []);
  assert.match(logs.at(-1), /checksum mismatch/);
});

test("invalid and prerelease metadata do not trigger a binary download", async (t) => {
  for (const release of [{ tag_name: "../../malicious" }, { tag_name: latest, prerelease: true }]) {
    const { options } = await fixture(t, { fetch: async (url) => {
      assert.equal(url, releaseUrl);
      return Response.json(release);
    } });
    assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  }
});

test("wrong executable version is rejected and staging is cleaned up", async (t) => {
  const { options } = await fixture(t);
  const getVersion = options.getVersion;
  options.getVersion = (command) => command.includes(".update-") ? Promise.resolve("2026.07.04") : getVersion(command);
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test("oversized response and missing platform assets fail safely", async (t) => {
  const { options } = await fixture(t, { fetch: async () => new Response("oversized", { headers: { "content-length": "999999999" } }) });
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  options.fetch = async () => Response.json({ tag_name: latest, assets: [] });
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
});

test("Windows selects the correct official asset for each CPU architecture", async (t) => {
  for (const [arch, asset] of [["x64", "yt-dlp.exe"], ["arm64", "yt-dlp_arm64.exe"], ["ia32", "yt-dlp_x86.exe"]]) {
    const { options } = await fixture(t, { platform: "win32", arch, fetch: async (url) => {
      if (url === releaseUrl) return Response.json({ tag_name: latest, assets: [{ name: asset }, { name: "SHA2-256SUMS" }] });
      if (url.endsWith("/SHA2-256SUMS")) return new Response(`${checksum}  ${asset}\n`);
      assert.equal(url, `https://github.com/yt-dlp/yt-dlp/releases/download/${latest}/${asset}`);
      return new Response(binary);
    } });
    const installed = await updateYtDlpOnStartup(options);
    assert.equal(path.basename(installed), "yt-dlp.exe");
    assert.notEqual(installed, options.fallbackPath);
  }
});

test("shutdown abort keeps the existing executable", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const { options } = await fixture(t, { signal: controller.signal });
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
});

test("unsupported platforms do not modify or download executables", async (t) => {
  const { options, calls } = await fixture(t, { platform: "linux" });
  assert.equal(await updateYtDlpOnStartup(options), options.fallbackPath);
  assert.deepEqual(calls, []);
});

test("interrupted binary downloads clean staging and preserve the last working cache", async (t) => {
  const { options } = await fixture(t);
  const installed = await updateYtDlpOnStartup(options);
  const controller = new AbortController();
  const next = "2026.09.17";
  const newChecksum = createHash("sha256").update("new binary").digest("hex");
  options.signal = controller.signal;
  options.fetch = async (url) => {
    if (url === releaseUrl) return Response.json({ tag_name: next, assets: [{ name: "yt-dlp_macos" }, { name: "SHA2-256SUMS" }] });
    if (url.endsWith("/SHA2-256SUMS")) return new Response(`${newChecksum}  yt-dlp_macos\n`);
    return new Response(new ReadableStream({ start(stream) {
      stream.enqueue(Buffer.from("partial"));
      controller.abort();
    } }));
  };
  assert.equal(await updateYtDlpOnStartup(options), installed);
  assert.deepEqual(await fs.readFile(installed), binary);
  assert.equal((await fs.readdir(options.directory)).length, 1);
});

test("the engine waits for the startup updater and uses its resolved binary", async () => {
  const { DownloadEngine } = require("../src/Worker/DownloadEngine.ts");
  let resolveUpdate;
  const ready = new Promise((resolve) => { resolveUpdate = resolve; });
  const engine = new DownloadEngine({
    ytDlpPath: "/missing-old-binary", resolveYtDlpPath: () => ready,
    ffmpegPath: path.resolve(__dirname, "../thirdparty/bin", process.platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    nodeRuntimePath: process.execPath, cacheDirectory: os.tmpdir(),
  });
  let done = false;
  const pending = engine.getDependencyStatuses().then((value) => { done = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  const actual = path.resolve(__dirname, "../thirdparty/bin", process.platform, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  resolveUpdate(actual);
  assert.equal((await pending).ytDlp.command, actual);
});

test("a download canceled while updating never begins extraction", async () => {
  const { DownloadEngine } = require("../src/Worker/DownloadEngine.ts");
  let resolveUpdate;
  const ready = new Promise((resolve) => { resolveUpdate = resolve; });
  const engine = new DownloadEngine({
    ytDlpPath: "/missing-old-binary", resolveYtDlpPath: () => ready,
    ffmpegPath: "/missing-ffmpeg", nodeRuntimePath: process.execPath, cacheDirectory: os.tmpdir(),
  });
  const pending = engine.execute({
    url: "https://www.youtube.com/watch?v=S7FczCXp9KA", segments: [{ start: 0, end: 1 }],
    encodingPreset: "davinci-dnxhr", downloadQuality: "best", speedLimit: "", basename: "test", outputDir: os.tmpdir(), locale: "en",
  }, (progress) => { engine.cancel(progress.jobId); });
  resolveUpdate("/missing-new-binary");
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancel/i);
  assert.doesNotMatch(result.error, /missing|not found|No such file/i);
});

test("a usable binary is ready immediately, then future jobs pick the background update", async (t) => {
  const { options } = await fixture(t);
  await fs.writeFile(options.fallbackPath, latest);
  const next = "2026.09.17";
  const nextBinary = Buffer.from(`test executable ${next}`);
  const nextChecksum = createHash("sha256").update(nextBinary).digest("hex");
  let resolveMetadata;
  options.fetch = async (url) => {
    if (url === releaseUrl) return new Promise((resolve) => { resolveMetadata = resolve; });
    if (url.endsWith("/SHA2-256SUMS")) return new Response(`${nextChecksum}  yt-dlp_macos\n`);
    return new Response(nextBinary);
  };
  const prepared = prepareYtDlpOnStartup(options);
  let finished = false;
  prepared.finished.then(() => { finished = true; });
  assert.equal(await prepared.getPath(), options.fallbackPath);
  assert.equal(finished, false);
  resolveMetadata(Response.json({ tag_name: next, assets: [{ name: "yt-dlp_macos" }, { name: "SHA2-256SUMS" }] }));
  const installed = await prepared.finished;
  assert.notEqual(installed, options.fallbackPath);
  assert.equal(await prepared.getPath(), installed);
});

test("an outdated first installation waits for a validated new binary", async (t) => {
  const { options } = await fixture(t);
  const originalFetch = options.fetch;
  let resolveMetadata;
  options.fetch = async (url, init) => url === releaseUrl
    ? new Promise((resolve) => { resolveMetadata = resolve; }) : originalFetch(url, init);
  const prepared = prepareYtDlpOnStartup(options);
  let ready = false;
  const pendingPath = prepared.getPath().then((command) => { ready = true; return command; });
  while (!resolveMetadata) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, false);
  resolveMetadata(Response.json({ tag_name: latest, assets: [{ name: "yt-dlp_macos" }, { name: "SHA2-256SUMS" }] }));
  const installed = await pendingPath;
  assert.notEqual(installed, options.fallbackPath);
  assert.equal(await prepared.finished, installed);
});
