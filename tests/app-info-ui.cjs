const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: false, width: 1200, height: 950 });
  await win.loadURL('http://127.0.0.1:' + server.address().port + '/?view=editor');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    while (!document.querySelector('#openPreferenceOverlayButton')) await wait(50);
    window.ytClipper.getAppInfo = async () => ({ name: 'kawai-downloader', version: '0.1.0', platform: 'darwin', arch: 'arm64', electronVersion: '41.0.0', chromeVersion: '146.0.7680.0' });
    document.querySelector('#openPreferenceOverlayButton').click(); await wait(100);
    [...document.querySelectorAll('[role=tab]')].find(el => el.textContent === 'App Info').click(); await wait(300);
    const panel = document.querySelector('.preference-app-info');
    const badges = [...panel.querySelectorAll('nav button')];
    const urls = [];
    for (const button of badges) { button.click(); await wait(20); urls.push(window.__mockExternalUrl); }
    return { count: badges.length, urls, runtime: panel.textContent.includes('Electron 41.0.0 · Chromium 146.0.7680.0'), platform: panel.textContent.includes('macOS · arm64'), ffmpeg: panel.textContent.includes('FFmpeg'), first: panel.firstElementChild.tagName };
  })()`);
  assert.equal(result.count, 4);
  assert.deepEqual(result.urls, ['https://kawaikara.github.io/', 'https://github.com/fabyday/yt-downloader', 'https://discord.gg/JJs974BX45', 'https://www.youtube.com/@molera1708']);
  assert.equal(result.runtime, true);
  assert.equal(result.platform, true);
  assert.equal(result.ffmpeg, true);
  assert.equal(result.first, 'NAV');
  fs.writeFileSync('/tmp/kawai-app-info.png', (await win.webContents.capturePage()).toPNG());
  win.setSize(640, 850);
  await new Promise(resolve => setTimeout(resolve, 300));
  const fits = await win.webContents.executeJavaScript(`(() => { const panel = document.querySelector('.preference-app-info'); return panel.scrollWidth <= panel.clientWidth + 1; })()`);
  assert.equal(fits, true, 'App Info must not overflow horizontally');
  console.log('App Info: shared badges, destinations, runtime versions, card order and narrow layout passed');
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
