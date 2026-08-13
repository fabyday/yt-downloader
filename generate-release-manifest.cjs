const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("./package.json");
const distDirectory = path.resolve(__dirname, "dist");
const repository = "fabyday/yt-downloader";

const artifacts = fs
  .readdirSync(distDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => createArtifact(entry.name))
  .filter(Boolean)
  .sort((left, right) =>
    `${left.platform}-${left.arch}-${left.kind}`.localeCompare(
      `${right.platform}-${right.arch}-${right.kind}`
    )
  );

if (artifacts.length === 0) {
  throw new Error("No DMG, ZIP, or Windows Setup EXE artifacts were found in dist.");
}

const manifest = { version: packageJson.version, artifacts };
const outputPath = path.join(distDirectory, "release-manifest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath} with ${artifacts.length} artifact(s).`);

function createArtifact(filename) {
  if (!filename.includes(packageJson.version)) {
    return null;
  }
  const extension = path.extname(filename).slice(1).toLowerCase();
  let platform;
  let kind;

  if (extension === "dmg" || extension === "zip") {
    platform = "darwin";
    kind = extension;
  } else if (extension === "exe" && /setup/i.test(filename)) {
    platform = "win32";
    kind = "exe";
  } else {
    return null;
  }

  const arch = /(?:^|[-_.])universal(?:[-_.]|$)/i.test(filename)
    ? "universal"
    : /(?:^|[-_.])arm64(?:[-_.]|$)/i.test(filename)
      ? "arm64"
      : /(?:^|[-_.])(?:x64|x86_64)(?:[-_.]|$)/i.test(filename)
        ? "x64"
        : process.arch;
  const filePath = path.join(distDirectory, filename);

  return {
    platform,
    arch,
    kind,
    url: `https://github.com/${repository}/releases/latest/download/${encodeURIComponent(filename)}`,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex")
  };
}
