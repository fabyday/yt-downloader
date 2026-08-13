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
  const token = crypto.randomBytes(24).toString("hex");
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\yt-worker-test-${sessionId}`
    : path.join(tempRoot, "worker.sock");
  const executable = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const ffmpegExecutable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const workerPath = path.join(projectRoot, "build", "worker", "worker.js");
  const child = spawn(process.execPath, [
    workerPath,
    "--ownership", "external-owned",
    "--endpoint", endpoint,
    "--session-id", sessionId,
    "--state-dir", path.join(tempRoot, "state"),
    "--cache-dir", path.join(tempRoot, "cache"),
    "--yt-dlp-path", path.join(projectRoot, "thirdparty", "bin", process.platform, executable),
    "--ffmpeg-path", path.join(projectRoot, "thirdparty", "bin", process.platform, ffmpegExecutable),
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
    assert.equal(hello.ownership, "external-owned");
    assert.equal(hello.sessionId, sessionId);

    const dependencies = await client.request("dependency.get", {});
    assert.equal(dependencies.ytDlp.available, true);
    assert.equal(dependencies.ffmpeg.available, true);
    assert.deepEqual(await client.request("queue.get", {}), []);
    assert.deepEqual(await client.request("queue.pause", { itemId: "missing" }), []);
    assert.deepEqual(await client.request("queue.resume", { itemId: "missing" }), []);
    assert.deepEqual(await client.request("queue.removeMany", { itemIds: [] }), []);
    assert.deepEqual(await client.request("queue.clear", {}), []);
    assert.deepEqual(await client.request("worker.shutdown", {}), {
      shuttingDown: true,
    });
    client.close();
    assert.equal(await waitForExit(child), 0);
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
