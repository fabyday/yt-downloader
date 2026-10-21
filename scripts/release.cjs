const { replaceDraft } = require('./draft-release.cjs');
const { writeDistributionManifest } = require('./distribution-manifest.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function parseVersion(value) {
  if (typeof value !== 'string') throw new Error('package.json version must be a SemVer string');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value);
  if (!match || (match[4] || '').split('.').some(id => /^0\d+$/.test(id))) throw new Error(`Invalid SemVer: ${value}`);
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') || [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function assertNewVersion(version, existing) {
  parseVersion(version);
  for (const tag of existing) {
    const previous = tag.replace(/^v/, '');
    try { parseVersion(previous); } catch { continue; }
    if (compareVersions(version, previous) <= 0) throw new Error(`Version ${version} must be newer than existing ${tag}. Update package.json before releasing.`);
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function checkRemote(repository, version, run = gh) {
  const tags = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repository}/tags?per_page=100`])).flat();
  const releases = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat();
  const published = releases.filter(release => !release.draft);
  const publishedTags = new Set(published.map(release => release.tag_name));
  const draftOnlyTags = new Set(releases.filter(release => release.draft && !publishedTags.has(release.tag_name)).map(release => release.tag_name));
  assertNewVersion(version, [
    ...tags.filter(tag => !draftOnlyTags.has(tag.name)).map(tag => tag.name),
    ...published.map(release => release.tag_name),
  ]);
  const matching = releases.filter(release => release.draft && release.tag_name === `v${version}`);
  if (matching.length > 1) throw new Error('Multiple drafts have the target version; review them before rebuilding.');
  return { tags, releases, replacement: matching[0] };
}

async function collectAssets(directory, version, repository) {
  parseVersion(version);
  const files = [], artifacts = [];
  for (const platform of ['darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    const folder = path.join(directory, `kawai-downloader-${platform}-${arch}`);
    const suffixes = platform === 'darwin' ? ['dmg', 'zip'] : ['Setup.exe', 'Portable.exe'];
    for (const suffix of suffixes) {
      const name = platform === 'darwin' ? `kawai-downloader-${version}-mac-${arch}.${suffix}` : `kawai-downloader-${version}-win-${arch}-${suffix}`;
      const file = path.join(folder, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || !stat.size) throw new Error(`Missing or invalid installer: ${name}`);
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      files.push(file);
      artifacts.push({ platform, arch, kind: path.extname(name).slice(1), url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}`, sha256: hash.digest('hex') });
    }
  }
  return { files, manifest: { version, artifacts } };
}

async function publishRelease(repository, version, sha, directory, run = gh) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Expected exact validated commit SHA');
  const { files, manifest } = await collectAssets(directory, version, repository);
  // Draft-only versions are rebuildable; published releases and unrelated tags remain protected.
  const remote = checkRemote(repository, version, run);
  const manifestPath = path.resolve(directory, 'release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const distributionFiles = writeDistributionManifest(directory, manifest, repository);
  return replaceDraft({ repository, version, sha, files: [...files, manifestPath, ...distributionFiles], manifest, remote, checkRemote, run, prerelease: parseVersion(version).pre.length > 0 });
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('GITHUB_REPOSITORY is required');
  if (process.argv[2] === 'validate') {
    const source = path.resolve(process.env.SOURCE_DIRECTORY || '.');
    const { version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    checkRemote(repository, version);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nsha=${sha}\n`);
    console.log(`Validated v${version} at ${sha}`);
  } else if (process.argv[2] === 'publish') {
    const version = process.env.RELEASE_VERSION, sha = process.env.RELEASE_SHA;
    const url = await publishRelease(repository, version, sha, 'release-assets');
    console.log(url);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Draft release prepared\n\n${url}\n\nCommit: \`${sha}\`\n\nReview and publish this draft manually in GitHub Releases.\n`);
  } else throw new Error('Usage: node scripts/release.cjs validate|publish');
}

module.exports = { parseVersion, compareVersions, assertNewVersion, checkRemote, collectAssets, publishRelease };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
