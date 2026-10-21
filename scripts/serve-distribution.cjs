#!/usr/bin/env node
const { createServer } = require("node:http");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { createDistributionManifest } = require("./distribution-manifest.cjs");
const pkg = require("../package.json");
const root = path.resolve(__dirname, "..");
const help = `Usage: pnpm dev:server [--artifact /path/app.dmg] [--port 8765] [--os darwin|win32] [--arch arm64|x64]

Serves a v1 installation manifest, product icon and one local installer on 127.0.0.1.
Default artifact: dist/<os>-<arch>/kawai-downloader-${pkg.version}-mac-<arch>.dmg
                  or kawai-downloader-${pkg.version}-win-<arch>-Setup.exe
Build first with pnpm build, or use pnpm dev:server:build.
In Kawaikara, run pnpm dev:external:local (default port 8765).
For dev-to-dev handshake testing, run pnpm start here; no installer server is needed.`;

/** Resolves a native target without serving the checkout or arbitrary requested paths. */
function resolveOptions(options = {}) {
  const os = options.os ?? process.platform,
    arch = options.arch ?? process.arch;
  const port = Number(options.port ?? 8765);
  if (!["darwin", "win32"].includes(os) || !["arm64", "x64"].includes(arch))
    throw new Error("Use --os darwin|win32 and --arch arm64|x64.");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Port must be between 1024 and 65535.");
  const filename =
    os === "darwin"
      ? `kawai-downloader-${pkg.version}-mac-${arch}.dmg`
      : `kawai-downloader-${pkg.version}-win-${arch}-Setup.exe`;
  const artifact = options.artifact
    ? path.resolve(options.artifact)
    : path.join(root, "dist", `${os}-${arch}`, filename);
  const format = path.extname(artifact).slice(1).toLowerCase();
  if (!(os === "darwin" ? ["dmg", "zip"] : ["exe"]).includes(format))
    throw new Error("Artifact format does not match --os.");
  return { os, arch, port, artifact, format };
}

/** Hashes a selected installer and builds an isolated local version of the release descriptor. */
async function createDistributionServer(options = {}) {
  const target = resolveOptions(options);
  let info;
  try {
    info = await stat(target.artifact);
  } catch {
    throw new Error(
      `Installer not found: ${target.artifact}\nRun pnpm build first, or pass --artifact /path/to/installer.`,
    );
  }
  if (!info.isFile() || !info.size)
    throw new Error("Installer must be a nonempty file.");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(target.artifact))
    hash.update(bytes);
  const artifactUrl = `/artifact.${target.format}`;
  const manifest = createDistributionManifest(
    {
      version: pkg.version,
      artifacts: [
        {
          platform: target.os,
          arch: target.arch,
          kind: target.format,
          url: `.${artifactUrl}`,
          sha256: hash.digest("hex"),
        },
      ],
    },
    "fabyday/yt-downloader",
  );
  manifest.icon = "./kawai-downloader-icon.png";
  manifest.guideUrl = "./guide";
  manifest.connection.guideUrl = "./guide";
  for (const entry of manifest.targets) entry.guideUrl = "./guide";
  const files = new Map([
    [artifactUrl, { path: target.artifact, type: "application/octet-stream" }],
    [
      "/kawai-downloader-icon.png",
      { path: path.join(root, "resources/app-icon.png"), type: "image/png" },
    ],
    [
      "/guide",
      {
        path: path.join(root, "Docs/ExternalApps.md"),
        type: "text/plain; charset=utf-8",
      },
    ],
  ]);
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (request.url === "/kawaikara.manifest.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(manifest));
      return;
    }
    const file = files.get(request.url);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("Content-Type", file.type);
    const stream = createReadStream(file.path);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
  return { server, manifest, target };
}

async function main() {
  const { values } = parseArgs({
    options: {
      artifact: { type: "string" },
      port: { type: "string" },
      os: { type: "string" },
      arch: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const { server, target, manifest } = await createDistributionServer(values);
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(target.port, "127.0.0.1", () => {
    console.log(
      `Manifest server: http://127.0.0.1:${target.port}/kawaikara.manifest.json`,
    );
    console.log(`Installer: ${target.artifact}`);
    if (target.port === 8765) console.log("Kawaikara: pnpm dev:external:local");
    else
      console.log(
        `Kawaikara: set KAWAIKARA_EXTERNAL_APP_TEST_MANIFEST=${manifest.id}=http://127.0.0.1:${target.port}/kawaikara.manifest.json, then run pnpm dev:external:installed`,
      );
    console.log(
      "Restart this server after rebuilding to refresh the checksum. Ctrl+C stops it.",
    );
  });
}
module.exports = { resolveOptions, createDistributionServer };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
