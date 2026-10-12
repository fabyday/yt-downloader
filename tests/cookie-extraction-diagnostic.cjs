const { testBinary } = require('./binaries.cjs');
// Explicit local diagnostic only. Never prints cookies, keys or raw yt-dlp output.
require('ts-node/register/transpile-only');
const { app } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CookieStore, prepareCookieDirectory } = require('../src/Worker/CookieStore.ts');
const { exportBrowserCookies } = require('../src/Worker/BrowserCookies.ts');
const { getBrowserProcessStatus } = require('../src/Worker/BrowserProcess.ts');
const appState = process.argv.includes('--app-state');
if (appState) app.setPath('userData', path.join(app.getPath('appData'), 'yt-section-downloader'));
app.whenReady().then(async () => {
  const browser = { browser: 'chrome' };
  if ((await getBrowserProcessStatus(browser)).running) {
    console.log('diagnostic: cookies.browserRunning'); app.exit(1); return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kawai-cookie-diagnostic-'));
  try {
    const contents = await exportBrowserCookies({ browser,
      command: process.env.COOKIE_DIAGNOSTIC_BINARY || testBinary('yt-dlp'), directory });
    const storeDirectory = await prepareCookieDirectory(appState ? app.getPath('userData') : path.join(directory, 'state'));
    const status = await new CookieStore(storeDirectory).import(contents);
    assert.equal(status.configured, true);
    const reopened = new CookieStore(storeDirectory);
    assert.deepEqual(await reopened.getStatus(), status);
    const snapshot = await reopened.createSnapshot();
    assert.ok(snapshot);
    assert.equal(await fs.readFile(snapshot.path, 'utf8'), contents);
    await snapshot.dispose();
    console.log(`diagnostic: extraction, save, reload and download snapshot succeeded (${status.count} cookies, ${appState ? 'actual app storage' : 'temporary storage'})`);
  } catch (error) {
    console.log('diagnostic:', /^cookies\.[a-zA-Z]+$/.test(error.message) ? error.message : 'unexpected failure');
    process.exitCode = 1;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
}).catch(() => { console.log('diagnostic: setup failure'); app.exit(1); });
