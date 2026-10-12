// Run after bundle:dev: electron tests/window-chrome-smoke.cjs
// Uses mock UI data only; never starts a Worker, reads browser cookies, or checks updates.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { app, Menu } = require('electron');
const { WindowManager } = require('../src/Main/Manager/WindowManager.ts');

app.disableHardwareAcceleration();
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => { console.error('Window smoke test timed out'); app.exit(1); }, 45000);

async function waitForUi(contents, selector) {
  if (contents.isLoading()) await once(contents, 'did-finish-load');
  await contents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return resolve();
      if (Date.now() - started > 5000) return reject(new Error('UI did not mount'));
      setTimeout(check, 50);
    };
    check();
  })`);
}

async function geometry(contents) {
  return contents.executeJavaScript(`(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const overlay = navigator.windowControlsOverlay;
    const area = overlay?.getTitlebarAreaRect();
    return {
      titlebar: rect('.window-title-bar'), content: rect('.window-title-bar-content'),
      tabs: rect('.browser-tab-strip'), panel: rect('.queue-window-panel'),
      drag: getComputedStyle(document.querySelector('.window-title-bar')).getPropertyValue('-webkit-app-region'),
      viewport: { width: innerWidth, height: innerHeight },
      overlay: area && { x: area.x, width: area.width, height: area.height, visible: overlay.visible },
    };
  })()`);
}

app.whenReady().then(async () => {
  await ready;
  const manager = new WindowManager(`http://127.0.0.1:${server.address().port}/`);
  // Omit the real IPC preload: the HTTP harness supplies a mock bridge.
  manager.createWebPreferences = () => ({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  const result = await manager.initialize();
  assert.equal(result.ok, true, JSON.stringify(result));
  const main = manager.mainWindow;
  await waitForUi(main.webContents, '.window-title-bar');
  assert.equal(Menu.getApplicationMenu(), null);
  if (process.platform !== 'darwin') assert.equal(main.isMenuBarVisible(), false);
  let layout = await geometry(main.webContents);
  assert.equal(layout.titlebar.height, 40);
  assert.equal(layout.tabs.y, 40);
  assert.equal(layout.tabs.height, 48);
  assert.equal(layout.drag, 'drag');
  assert.ok(Math.abs(layout.content.x + layout.content.width / 2 - layout.viewport.width / 2) < 1);
  if (process.platform === 'win32') {
    assert.equal(layout.overlay.visible, true);
    assert.ok(layout.content.right <= layout.overlay.x + layout.overlay.width + 1);
  }
  for (const tab of manager.tabs.values()) assert.equal(tab.view.getBounds().y, 88);
  fs.writeFileSync(path.join(__dirname, '../build/titlebar-main.png'), (await main.webContents.capturePage()).toPNG());
  main.maximize();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(main.isMaximized(), true);
  for (const tab of manager.tabs.values()) {
    assert.equal(tab.view.getBounds().height, main.getContentSize()[1] - 88);
  }
  main.unmaximize();
  await new Promise((resolve) => setTimeout(resolve, 150));
  main.minimize();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(main.isMinimized(), true);
  main.restore();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(main.isMinimized(), false);
  manager.openQueueWindow();
  const queue = manager.queueWindow;
  await waitForUi(queue.webContents, '.queue-window-panel');
  layout = await geometry(queue.webContents);
  if (process.platform !== 'darwin') assert.equal(queue.isMenuBarVisible(), false);
  assert.equal(layout.titlebar.height, 40);
  assert.equal(layout.panel.y, 52);
  assert.ok(layout.panel.bottom <= layout.viewport.height - 11);
  fs.writeFileSync(path.join(__dirname, '../build/titlebar-queue.png'), (await queue.webContents.capturePage()).toPNG());
  const closed = once(queue, 'closed');
  queue.close();
  await closed;
  assert.equal(manager.queueWindow, null);
  console.log(JSON.stringify({ success: true, platform: process.platform, queueLayout: layout }));
  await manager.finalize();
  server.close();
  clearTimeout(deadline);
  app.exit(0);
}).catch((error) => { console.error(error); server.close(); clearTimeout(deadline); app.exit(1); });
