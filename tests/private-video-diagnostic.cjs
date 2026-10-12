const { testBinary } = require('./binaries.cjs');
// User-invoked network diagnostic. Prints no cookies, titles or signed media URLs.
require('ts-node/register/transpile-only');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CookieStore } = require('../src/Worker/CookieStore.ts');
const { DownloadEngine } = require('../src/Worker/DownloadEngine.ts');
const root = path.resolve(__dirname, '..');
const url = process.argv[2];
if (!url || !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/.test(url)) throw new Error('Supply a YouTube watch URL');
const binary = testBinary('yt-dlp');
const runtime = require('electron');
const base = ['--ignore-config', '--no-playlist', '--no-cache-dir', '--socket-timeout', '15',
  '--retries', '1', '--extractor-retries', '1', '--no-js-runtimes', '--js-runtimes', `node:${runtime}`];
function run(args) {
  return new Promise(resolve => execFile(binary, args, {
    timeout: 90000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 'failed') : 0, stdout, stderr })));
}
function report(label, result, metadata) {
  const reasons = [
    [/private video/i, 'private-video'], [/sign in|login required|log in/i, 'login-required'],
    [/no longer valid|expired cookies|cookies.*expired|cookies.*rotated/i, 'cookies-expired-or-rotated'],
    [/403|forbidden/i, 'http-403'], [/PO Token/i, 'po-token'], [/challenge|signature|nsig/i, 'js-challenge'],
    [/unsupported.*cookie|does not support cookies|skipping.*client/i, 'client-cookie-support'],
    [/requested format is not available/i, 'format-unavailable'], [/timed out|timeout/i, 'timeout'],
  ].filter(([pattern]) => pattern.test(result.stderr)).map(([, name]) => name);
  let details = {};
  if (!result.code && metadata) {
    const info = JSON.parse(result.stdout);
    details = { availability: info.availability, playableInEmbed: info.playable_in_embed, formatCount: info.formats?.length || 0 };
  }
  console.log(JSON.stringify({ label, code: result.code, reasons, ...details }));
}
async function main() {
  const store = new CookieStore(path.join(os.homedir(), 'Library/Application Support/yt-section-downloader/downloader-auth'));
  const snapshot = await store.createSnapshot();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kawai-private-video-'));
  try {
    const anonymous = await run([...base, '--skip-download', '--dump-single-json', url]);
    report('without-cookies', anonymous, true);
    if (!snapshot) { console.log('No saved cookies'); return; }
    const authenticated = await run([...base, '--cookies', snapshot.path, '--skip-download', '--dump-single-json', url]);
    report('saved-cookies', authenticated, true);
    if (process.argv.includes('--metadata-only')) return;
    if (authenticated.code) return;
    const clip = await run([...base, '--cookies', snapshot.path, '--ffmpeg-location', testBinary('ffmpeg'),
      '-f', 'worstvideo[height<=360]+worstaudio/worst', '--download-sections', '*0-2', '--force-keyframes-at-cuts',
      '--merge-output-format', 'mkv', '-o', path.join(directory, 'probe.%(ext)s'), url]);
    report('two-second-download', clip, false);
    const files = await fs.readdir(directory);
    console.log(JSON.stringify({ outputFiles: files.length, bytes: (await Promise.all(files.map(name => fs.stat(path.join(directory, name))))).reduce((sum, stat) => sum + stat.size, 0) }));
    const engine = new DownloadEngine({ cacheDirectory: path.join(directory, 'cache'),
      ffmpegPath: testBinary('ffmpeg'), nodeRuntimePath: runtime,
      ytDlpPath: binary, createCookieSnapshot: () => store.createSnapshot() });
    const timeout = setTimeout(() => engine.cancelAll(), 90000);
    try {
      const result = await engine.execute({ url, segments: [{ start: 0, end: 2 }], downloadQuality: '360',
        speedLimit: '', encodingPreset: 'youtube-copy', basename: 'engine-probe',
        outputDir: path.join(directory, 'engine-output'), locale: 'en' }, () => {});
      const outputs = await fs.readdir(path.join(directory, 'engine-output'));
      console.log(JSON.stringify({ label: 'app-download-engine', success: result.ok,
        outputFiles: outputs.length, bytes: (await Promise.all(outputs.map(name => fs.stat(path.join(directory, 'engine-output', name))))).reduce((sum, stat) => sum + stat.size, 0) }));
    } finally { clearTimeout(timeout); engine.cancelAll(); }
  } finally {
    await snapshot?.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('Diagnostic failed before completion; sensitive details omitted.'); process.exitCode = 1; });
