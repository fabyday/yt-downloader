const { testBinary } = require('./binaries.cjs');
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yt-worker-test-"));
  const sessionId = crypto.randomUUID();
  const ownership = process.argv.includes("--app-owned") ? "app-owned" : "external-owned";
  const token = crypto.randomBytes(24).toString("hex");
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\yt-worker-test-${sessionId}`
    : path.join(tempRoot, "worker.sock");
  const executable = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const ffmpegExecutable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const workerPath = path.join(projectRoot, "build", "worker", "worker.js");
  await fs.mkdir(path.join(tempRoot, 'state'));
  // Reproduce Electron's file collision even on case-sensitive CI disks.
  const electronCookies = path.join(tempRoot, 'state', 'cookies');
  await fs.writeFile(electronCookies, 'SQLite fixture - must not be overwritten');
  const child = spawn(process.execPath, [
    workerPath,
    "--ownership", ownership,
    "--endpoint", endpoint,
    "--session-id", sessionId,
    "--state-dir", path.join(tempRoot, "state"),
    "--cache-dir", path.join(tempRoot, "cache"),
    "--yt-dlp-path", testBinary('yt-dlp'),
    "--ffmpeg-path", testBinary('ffmpeg'),
    "--node-runtime", process.execPath,
  ], {
    env: { ...process.env, YT_DOWNLOADER_WORKER_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitForReady(child);
    const client = await createClient(endpoint);
    const hello = await client.request("worker.hello", {
      clientName: "worker-integration-test",
      protocolVersion: 1,
      token,
    });
    assert.equal(hello.protocolVersion, 1);
    assert.equal(hello.ownership, ownership);
    assert.equal(hello.sessionId, sessionId);
    assert.deepEqual((await client.request("cookies.status", {})).sites.youtube, { configured: false, count: 0 });
    await assert.rejects(client.request("cookies.import-browser", { browser: "unsupported" }), /cookies.invalidBrowser/);
    assert.deepEqual(await client.request("cookies.import", {
      contents: '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest-only\n',
    }), { configured: true, count: 1 });
    assert.deepEqual(await client.request("cookies.clear", {}), { configured: false, count: 0 });
    assert.deepEqual(await client.request("cookies.import-data", {
      format: "records", cookies: [{ domain: ".youtube.com", name: "SID", value: "test-only", secure: true }],
    }), { configured: true, count: 1 });
    const browser = await client.request("cookies.browser-status", { browser: "chrome" });
    assert.equal(typeof browser.running, "boolean");
    await fs.writeFile(path.join(tempRoot, "state", "downloader-auth", "youtube-cookies.txt"), "broken fixture");
    assert.deepEqual((await client.request("cookies.status", {})).sites.youtube, { configured: false, count: 0, error: "cookies.readFailed" });
    assert.deepEqual(await client.request("cookies.clear", {}), { configured: false, count: 0 });
    await client.request("cookies.import-data", { site: "chzzk", format: "records", cookies: [
      { domain: ".naver.com", name: "NID_AUT", value: "fixture-only" },
      { domain: ".naver.com", name: "NID_SES", value: "fixture-only" },
    ] });
    const siteStatus = await client.request("cookies.status", {});
    assert.equal(siteStatus.sites.youtube.configured, false);
    assert.deepEqual(siteStatus.sites.chzzk, { configured: true, count: 2, loginCookiesPresent: true });
    assert.equal(await client.request("cookies.preview", {}), null, 'Naver cookies never enter YouTube preview IPC');
    await client.request("cookies.clear", {});
    assert.equal((await client.request("cookies.status", {})).sites.chzzk.configured, true);
    await client.request("cookies.clear", { site: "chzzk" });
    await assert.rejects(client.request("cookies.clear", { site: "../youtube" }), /cookies.invalidSite/);
    const updateStatus = await client.request("dependency.update-status", {});
    assert.equal(typeof updateStatus.status, 'string');
    if (ownership === 'external-owned') assert.equal(updateStatus.status, 'managed');
    if (ownership === 'external-owned') assert.equal((await client.request('dependency.update-check', {})).status, 'managed');

    const dependencies = await client.request("dependency.get", {});
    assert.equal(dependencies.ytDlp.available, true);
    assert.equal(dependencies.ffmpeg.available, true);
    assert.deepEqual(await client.request("queue.get", {}), []);
    assert.deepEqual(await client.request("cookies.profiles", { browser: "safari" }), { supported: false, profiles: [] });
    assert.deepEqual(await client.request("queue.pause", { itemId: "missing" }), []);
    assert.deepEqual(await client.request("queue.resume", { itemId: "missing" }), []);
    assert.deepEqual(await client.request("queue.removeMany", { itemIds: [] }), []);
    assert.deepEqual(await client.request("queue.clear", {}), []);
    assert.deepEqual(await client.request("worker.shutdown", {}), {
      shuttingDown: true,
    });
    client.close();
    assert.equal(await waitForExit(child), 0);
    assert.equal(await fs.readFile(electronCookies, 'utf8'), 'SQLite fixture - must not be overwritten');
    console.log(JSON.stringify({ hello, dependencies }, null, 2));
  } finally {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  if (stderr.trim()) process.stderr.write(stderr);
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Worker ready timeout")), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "ready") {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited before ready: ${code}`));
    });
  });
}

function createClient(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = "";
    let sequence = 0;
    const pending = new Map();
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type !== "response") continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        message.error
          ? request.reject(new Error(message.error.message))
          : request.resolve(message.result);
      }
    });
    socket.once("error", reject);
    socket.once("connect", () => resolve({
      request(method, params) {
        const id = String(++sequence);
        return new Promise((requestResolve, requestReject) => {
          pending.set(id, { resolve: requestResolve, reject: requestReject });
          socket.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
        });
      },
      close() { socket.end(); },
    }));
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
