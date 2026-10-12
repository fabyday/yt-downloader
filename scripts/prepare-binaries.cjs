const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const extract = require('extract-zip');
const { assertArchitecture } = require('./binary-architecture.cjs');
const root = path.resolve(__dirname, '..');

async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function download(source, cache, request) {
  const file = path.join(cache, source.sha256);
  try { if (await hash(file) === source.sha256) return file; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`Downloading ${source.url}`);
  const response = await request(source.url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${source.url}`);
  const partial = `${file}.${crypto.randomUUID()}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    if (await hash(partial) !== source.sha256) throw new Error(`SHA-256 mismatch: ${source.url}`);
    await fs.rename(partial, file);
  } finally { await fs.rm(partial, { force: true }); }
  return file;
}

async function findFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await findFiles(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

async function installFile(source, destination, executable = false) {
  const expected = await hash(source);
  // Do not replace a matching executable: another app/test may be running it.
  try {
    if (await hash(destination) === expected) {
      if (executable && process.platform !== 'win32') await fs.chmod(destination, 0o755);
      return expected;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${destination}.${crypto.randomUUID()}.part`;
  try {
    await fs.copyFile(source, temporary);
    if (executable && process.platform !== 'win32') await fs.chmod(temporary, 0o755);
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
  return expected;
}

async function prepareBinaries({ platform, arch }, configuration = {}) {
  const sources = configuration.sources || require('./binary-sources.json');
  const directory = configuration.root || root;
  const request = configuration.fetch || fetch;
  const target = `${platform}-${arch}`;
  if (!sources.ffmpeg[target]) throw new Error(`Unsupported binary target: ${target}`);
  const cache = path.join(directory, '.cache/build-binaries/downloads');
  const output = path.join(directory, '.cache/build-binaries', target);
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
  const selected = { 'yt-dlp': sources['yt-dlp'][platform === 'darwin' ? 'darwin' : target], ffmpeg: sources.ffmpeg[target] };
  const notices = sources['ffmpeg-notices'][target] || [];
  const fingerprint = JSON.stringify({ target, selected, notices });
  const receiptPath = path.join(output, 'prepared.json');
  try {
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    if (receipt.fingerprint === fingerprint) {
      for (const name of Object.keys(selected)) {
        const executable = name + (platform === 'win32' ? '.exe' : '');
        const file = path.join(output, executable);
        if (!receipt.hashes?.[name] || await hash(file) !== receipt.hashes[name]) throw new Error('Invalid prepared binary');
        assertArchitecture(file, platform, arch);
        if (platform === 'darwin') await fs.access(file, require('node:fs').constants.X_OK);
      }
      // Keep distributable attribution alongside the binaries, even after cleanup.
      for (const notice of receipt.notices || []) {
        if (path.isAbsolute(notice) || notice.split(/[\\/]/).includes('..')) throw new Error('Invalid notice path');
        await fs.access(path.join(output, 'licenses', notice));
      }
      await fs.access(path.join(output, 'sources.json'));
      console.log(`Verified cached native binaries: ${target}`);
      return output;
    }
  } catch { /* Missing, changed or corrupt preparation is rebuilt from verified assets. */ }
  const hashes = {};
  for (const [name, source] of Object.entries(selected)) {
    const asset = await download(source, cache, request);
    const executable = name + (platform === 'win32' ? '.exe' : '');
    let binary = asset;
    let temporary;
    try {
      if (source.archive === 'zip') {
        temporary = await fs.mkdtemp(path.join(cache, 'extract-'));
        await extract(asset, { dir: temporary });
        const entries = await findFiles(temporary);
        const matches = entries.filter(file => path.basename(file) === executable);
        if (matches.length !== 1) throw new Error(`Expected one ${executable} in ${source.url}`);
        binary = matches[0];
        for (const notice of entries.filter(file => /^(LICENSE|COPYING|README)/i.test(path.basename(file)))) {
          const destination = path.join(output, 'licenses', path.relative(temporary, notice));
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(notice, destination);
        }
      }
      assertArchitecture(binary, platform, arch);
      hashes[name] = await installFile(binary, path.join(output, executable), true);
    } finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
  }
  for (const source of notices) {
    await installFile(await download(source, cache, request), path.join(output, 'licenses', path.basename(source.url)));
  }
  await fs.writeFile(path.join(output, 'sources.json'), JSON.stringify({ target, ...selected }, null, 2) + '\n');
  const noticePaths = (await findFiles(path.join(output, 'licenses'))).map(file => path.relative(path.join(output, 'licenses'), file));
  const receiptTemporary = `${receiptPath}.${crypto.randomUUID()}.part`;
  try {
    await fs.writeFile(receiptTemporary, JSON.stringify({ fingerprint, hashes, notices: noticePaths }) + '\n');
    await fs.rename(receiptTemporary, receiptPath);
  } finally { await fs.rm(receiptTemporary, { force: true }); }
  console.log(`Verified native binaries: ${target}`);
  return output;
}
module.exports = { prepareBinaries };
if (require.main === module) {
  const { parseOptions } = require('./build.cjs');
  prepareBinaries(parseOptions(process.argv.slice(2))).catch(error => { console.error(error); process.exitCode = 1; });
}
