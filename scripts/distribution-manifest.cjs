const fs = require('node:fs');
const path = require('node:path');

/** Builds the public, data-only Kawaikara descriptor from already verified release artifacts. */
function createDistributionManifest(release, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const base = `https://github.com/${repository}/releases/download/v${release.version}`;
  const guide = `https://github.com/${repository}#readme`;
  return {
    schemaVersion: 1,
    id: 'day.faby.kawai-downloader',
    name: 'kawai-downloader',
    icon: `${base}/kawai-downloader-icon.png`,
    homepage: `https://github.com/${repository}`,
    guideUrl: guide,
    connection: {
      protocolVersion: 1,
      transport: 'loopback',
      launchScheme: 'kawai-downloader',
      guideUrl: `https://github.com/${repository}/blob/v${release.version}/Docs/ExternalApps.md`,
    },
    // The installer is preferred to portable EXEs. ZIP alternatives remain downloadable.
    targets: release.artifacts.filter(item => !/Portable\.exe$/i.test(item.url)).map(item => ({
      os: item.platform,
      arch: item.arch,
      version: release.version,
      guideUrl: guide,
      artifact: { url: item.url, format: item.kind, sha256: item.sha256 },
    })),
  };
}

/** Emits a version-pinned descriptor plus the actual product PNG into the release directory. */
function writeDistributionManifest(directory, release, repository) {
  const manifestPath = path.resolve(directory, 'kawaikara.manifest.json');
  const iconPath = path.resolve(directory, 'kawai-downloader-icon.png');
  fs.writeFileSync(manifestPath, JSON.stringify(createDistributionManifest(release, repository), null, 2) + '\n');
  fs.copyFileSync(path.join(__dirname, '../resources/app-icon.png'), iconPath);
  return [manifestPath, iconPath];
}
module.exports = { createDistributionManifest, writeDistributionManifest };
