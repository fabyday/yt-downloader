const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CookieStore, normalizeCookieFile, prepareCookieDirectory } = require('../src/Worker/CookieStore.ts');
const { DownloadEngine } = require('../src/Worker/DownloadEngine.ts');
const { exportBrowserCookies, normalizeBrowserCookieExpiry } = require('../src/Worker/BrowserCookies.ts');
const { browserCookieSpec } = require('../src/Shared/cookies.ts');

const row = (domain, value = 'test-value', expires = '0') => `${domain}\tTRUE\t/\tTRUE\t${expires}\tSID\t${value}`;
const file = (...rows) => ['# Netscape HTTP Cookie File', ...rows, ''].join('\n');

test('cookie storage never overwrites Electron Cookies and migrates a legacy directory only once', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-cookie-location-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const collision = path.join(root, 'collision');
  await fs.mkdir(collision);
  await fs.writeFile(path.join(collision, 'cookies'), 'Electron SQLite fixture');
  const directory = await prepareCookieDirectory(collision);
  assert.equal(path.basename(directory), 'downloader-auth');
  await new CookieStore(directory).import(file(row('.youtube.com')));
  assert.equal(await fs.readFile(path.join(collision, 'cookies'), 'utf8'), 'Electron SQLite fixture');
  const legacyState = path.join(root, 'legacy');
  await new CookieStore(path.join(legacyState, 'cookies')).import(file(row('.youtube.com')));
  const migrated = await prepareCookieDirectory(legacyState);
  assert.deepEqual(await new CookieStore(migrated).getStatus(), { configured: true, count: 1 });
  await new CookieStore(migrated).clear();
  assert.equal(await prepareCookieDirectory(legacyState), migrated);
  assert.deepEqual(await new CookieStore(migrated).getStatus(), { configured: false, count: 0 });
});

test('Chromium exports convert microseconds since 1601 without accepting malformed input', () => {
  const now = 1800000000000;
  const chromiumExpiry = seconds => ((BigInt(seconds) + 11644473600n) * 1000000n).toString();
  const original = file(row('.youtube.com', 'future', chromiumExpiry(1900000000)),
    row('.youtube.com', 'expired', chromiumExpiry(1700000000)),
    row('.google.com', 'session', '0'), row('.youtube.com', 'normal', '1900000000'));
  const converted = normalizeBrowserCookieExpiry(original, 'chrome');
  const result = normalizeCookieFile(converted, now);
  assert.equal(result.count, 3);
  assert.doesNotMatch(result.contents, /expired/);
  assert.match(result.contents, /1900000000\tSID\tfuture/);
  assert.equal(normalizeBrowserCookieExpiry(converted, 'chrome'), converted);
  assert.equal(normalizeBrowserCookieExpiry(original, 'firefox'), original);
  assert.equal(normalizeBrowserCookieExpiry(original, 'safari'), original);
  assert.throws(() => normalizeCookieFile(normalizeBrowserCookieExpiry(file(row('.youtube.com', 'x', '9999999999999999999')), 'chrome')), /cookies.invalid/);
});

test('browser import permits only supported browsers and profile names', () => {
  assert.equal(browserCookieSpec({ browser: 'chrome', profile: 'Profile 1' }), 'chrome:Profile 1');
  assert.equal(browserCookieSpec({ browser: 'firefox' }), 'firefox');
  for (const value of [{ browser: 'malicious' }, { browser: 'chrome', profile: '../../etc' },
    { browser: 'chrome', profile: 'Default::container' }, { browser: 'chrome', profile: '--x:evil' },
    { browser: 'safari', profile: 'Default' }]) assert.throws(() => browserCookieSpec(value), /cookies.invalid/);
});

test('browser export filters cookies and removes the full temporary jar even on CLI missing-URL exit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-browser-cookie-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let exportedPath;
  const contents = await exportBrowserCookies({
    browser: { browser: 'edge', profile: 'Profile 1' }, command: 'mock-yt-dlp', directory,
    run: async (command, args) => {
      assert.equal(command, 'mock-yt-dlp');
      assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'edge:Profile 1');
      assert.ok(!args.some((arg) => arg.startsWith('https:')));
      exportedPath = args[args.indexOf('--cookies') + 1];
      await fs.writeFile(exportedPath, file(row('.youtube.com', 'from-chromium', ((BigInt(Math.floor(Date.now() / 1000) + 86400) + 11644473600n) * 1000000n).toString()), row('.unrelated.test')));
      return { code: 2, stderr: 'ERROR: You must provide at least one URL.' };
    },
  });
  assert.match(contents, /youtube.com/);
  assert.doesNotMatch(contents, /unrelated/);
  await assert.rejects(fs.stat(exportedPath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(directory), []);
});

test('browser failure preserves the previous setting and cleans temporary exports without leaking diagnostics', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-browser-failure-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CookieStore(directory);
  await store.import(file(row('.youtube.com')));
  for (const [stderr, expected] of [
    ['ERROR: Could not copy Chrome cookie database secret-path', 'browserLocked'],
    ['ERROR: Failed to decrypt with DPAPI secret-cookie', 'decryptFailed'],
    ['WARNING: find-generic-password failed secret-data', 'keychainAccessFailed'],
    ['ERROR: Permission denied secret-path', 'permissionDenied'],
    ['ERROR: Operation not permitted secret-path', 'permissionDenied'],
    ['ERROR: could not find firefox cookies database', 'browserMissing'],
    ['ERROR: something secret happened', 'browserFailed'],
  ]) {
    await assert.rejects(store.importFrom(() => exportBrowserCookies({
      browser: { browser: 'chrome' }, command: 'mock', directory,
      run: async (_command, args) => {
        await fs.writeFile(args[args.indexOf('--cookies') + 1], file(row('.unrelated.test')));
        return { code: 1, stderr };
      },
    })), { message: `cookies.${expected}` });
    assert.deepEqual(await store.getStatus(), { configured: true, count: 1 });
    assert.deepEqual(await fs.readdir(directory), ['youtube-cookies.txt']);
  }
});

test('filters unrelated, lookalike and expired cookies, preserving HttpOnly and session cookies', () => {
  const result = normalizeCookieFile(file(
    '#HttpOnly_' + row('.youtube.com'), row('.google.com'), row('.notyoutube.com'),
    row('.youtube.com.evil.test'), row('.example.com'), row('.youtube.com', 'expired', '1'),
  ));
  assert.equal(result.count, 2);
  assert.match(result.contents, /#HttpOnly_\.youtube.com/);
  assert.doesNotMatch(result.contents, /evil|example|expired|notyoutube/);
});

test('rejects invalid/oversized input without including secrets in errors', () => {
  for (const value of [null, '{}', 'secret-cookie', file('secret-cookie'), 'x'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => normalizeCookieFile(value), /^Error: cookies.invalid$/);
  }
  assert.throws(() => normalizeCookieFile(file(row('.example.com'))), /^Error: cookies.empty$/);
});

test('persists imports, isolates active jars, and never resurrects a removed configuration', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-cookies-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CookieStore(directory);
  assert.deepEqual(await store.getStatus(), { configured: false, count: 0 });
  await store.import(file(row('.youtube.com', 'first')));
  const snapshot = await store.createSnapshot();
  assert.ok(snapshot);
  await store.import(file(row('.youtube.com', 'second')));
  assert.match(await fs.readFile(snapshot.path, 'utf8'), /first/);
  assert.deepEqual(await new CookieStore(directory).getStatus(), { configured: true, count: 1 });
  await assert.rejects(store.import('invalid'), /cookies.invalid/);
  assert.deepEqual(await store.getStatus(), { configured: true, count: 1 });
  await store.clear();
  // Simulate yt-dlp saving its jar on exit after the user removed cookies.
  await fs.writeFile(snapshot.path, file(row('.youtube.com', 'changed')));
  await snapshot.dispose();
  assert.equal(await store.createSnapshot(), null);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('downloads pass the private cookie jar to yt-dlp and dispose it on success and failure', async (t) => {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const childProcess = require('node:child_process');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-cookie-engine-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CookieStore(path.join(directory, 'cookies'));
  await store.import(file(row('.youtube.com')));
  const calls = [];
  let fail = false;
  let cookiePath;
  const originalSpawn = childProcess.spawn;
  t.after(() => { childProcess.spawn = originalSpawn; });
  childProcess.spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    setImmediate(async () => {
      try {
        if (args[0] === '--version') child.stdout.write('2026.10.01\n');
        else if (args[0] === '-version') child.stdout.write('ffmpeg version test\n');
        else if (command === 'fake-yt-dlp') {
          calls.push(args);
          cookiePath = args[args.indexOf('--cookies') + 1];
          assert.match(await fs.readFile(cookiePath, 'utf8'), /test-value/);
          if (fail) {
            child.stderr.write('HTTP Error 403: Forbidden\n');
            child.exitCode = 1;
            child.emit('close', 1);
            return;
          }
          assert.ok(args.includes('ffmpeg:-progress pipe:2 -nostats'));
          child.stderr.write('frame=25 time=00:00:02.50 bitrate=100kbits/s\r');
          child.stderr.write('out_time_us=');
          child.stdout.write('[info] download active\n');
          child.stderr.write('4000000\n');
          child.stdout.write('[download] 10.0% of 1MiB\r');
          await fs.writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mkv'), 'fake section');
        } else {
          assert.ok(args.includes('-progress'));
          child.stderr.write('out_time_us=N/A\nout_time_us=2500000\n');
          await fs.writeFile(args.at(-1), 'fake output');
        }
        child.exitCode = 0;
        child.emit('close', 0);
      } catch (error) { child.emit('error', error); }
    });
    return child;
  };
  const engine = new DownloadEngine({
    cacheDirectory: path.join(directory, 'cache'), ytDlpPath: 'fake-yt-dlp',
    ffmpegPath: 'fake-ffmpeg', nodeRuntimePath: process.execPath,
    createCookieSnapshot: () => store.createSnapshot(),
  });
  const payload = {
    url: 'https://www.youtube.com/watch?v=test', locale: 'en',
    segments: [{ start: 5, end: 10 }], downloadQuality: '720', speedLimit: '',
    encodingPreset: 'youtube-copy', basename: 'test', outputDir: path.join(directory, 'output'),
    resumeKey: 'success', keepSourceCache: true,
  };
  const updates = [];
  assert.equal((await engine.execute(payload, update => updates.push(update))).ok, true);
  const downloading = updates.filter(update => update.stage === 'downloading');
  assert.ok(downloading.some(update => Math.abs(update.progress - 0.35) < 0.0001));
  assert.ok(downloading.some(update => Math.abs(update.progress - 0.56) < 0.0001));
  assert.match(downloading.at(-1).message, /yt-dlp.*80%/);
  assert.equal(downloading.at(-1).logMessage, '[download] 10.0% of 1MiB');
  assert.ok(updates.some(update => update.stage === 'cutting' &&
    Math.abs(update.progress - 0.84) < 0.0001 && /ffmpeg.*50%/.test(update.message)));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('--cookies'));
  await assert.rejects(fs.stat(cookiePath), { code: 'ENOENT' });
  fail = true;
  const result = await engine.execute({ ...payload, resumeKey: 'failure' }, () => {});
  assert.equal(result.ok, false);
  assert.equal(calls.length, 3); // initial failure and one fresh-URL retry
  assert.doesNotMatch(result.error, /test-value/);
  await assert.rejects(fs.stat(cookiePath), { code: 'ENOENT' });
  assert.deepEqual(await store.getStatus(), { configured: true, count: 1 });
});
