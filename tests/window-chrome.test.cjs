const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {
  getWindowChromeOptions, installMacWindowShortcuts,
  TITLE_BAR_HEIGHT, TAB_STRIP_HEIGHT, SHELL_CHROME_HEIGHT,
} = require('../src/Main/WindowChrome.ts');

test('native overlay uses platform controls and a matching CSS/content inset', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const options = getWindowChromeOptions(platform);
    assert.equal(options.titleBarStyle, 'hidden');
    assert.equal(options.autoHideMenuBar, true);
    assert.equal(options.titleBarOverlay.height, TITLE_BAR_HEIGHT);
    // Keep the native frame for resizing, snapping and OS window controls.
    assert.notEqual(options.frame, false);
    assert.deepEqual(options.trafficLightPosition, platform === 'darwin' ? { x: 14, y: 13 } : undefined);
  }
  assert.equal(SHELL_CHROME_HEIGHT, TITLE_BAR_HEIGHT + TAB_STRIP_HEIGHT);
  const css = fs.readFileSync(path.join(__dirname, '../src/Renderer/styles.css'), 'utf8');
  assert.ok(css.includes(`--window-title-bar-height: ${TITLE_BAR_HEIGHT}px`));
  assert.ok(css.includes(`--browser-tab-strip-height: ${TAB_STRIP_HEIGHT}px`));
  assert.match(css, /env\(titlebar-area-x/);
  assert.match(css, /env\(titlebar-area-width/);
});

test('menu-less macOS keeps editing and window shortcuts without intercepting other keys', () => {
  const contents = new EventEmitter();
  const actions = [];
  for (const name of ['selectAll', 'copy', 'paste', 'cut', 'undo', 'redo']) {
    contents[name] = () => actions.push(name);
  }
  installMacWindowShortcuts(contents, () => actions.push('close'), () => actions.push('quit'), 'darwin');
  const key = (value, modifiers = {}) => {
    let prevented = false;
    contents.emit('before-input-event', { preventDefault() { prevented = true; } }, {
      type: 'keyDown', key: value, meta: true, control: false, alt: false, shift: false, ...modifiers,
    });
    return prevented;
  };
  for (const value of ['a', 'c', 'v', 'x', 'z']) assert.equal(key(value), true);
  assert.equal(key('Z', { shift: true }), true);
  assert.equal(key('w'), true);
  assert.equal(key('q'), true);
  assert.deepEqual(actions, ['selectAll', 'copy', 'paste', 'cut', 'undo', 'redo', 'close', 'quit']);
  for (const modifiers of [{ meta: false }, { alt: true }, { control: true }, { type: 'keyUp' }, { shift: true }]) {
    assert.equal(key('c', modifiers), false);
  }
  assert.equal(key('p'), false);
  const windowsContents = new EventEmitter();
  installMacWindowShortcuts(windowsContents, () => {}, () => {}, 'win32');
  assert.equal(windowsContents.listenerCount('before-input-event'), 0);
});

test('main and queue remove menus, and editor views stay below both chrome rows on resize', async () => {
  const windows = [];
  const views = [];
  const menus = [];
  class Contents extends EventEmitter {
    isDestroyed() { return false; }
    setWindowOpenHandler() {}
    loadURL(url) { this.url = url; return Promise.resolve(); }
    send() {}
    focus() {}
    close() {}
  }
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new Contents();
      this.contentView = { addChildView() {}, removeChildView() {} };
      this.size = [options.width, options.height]; windows.push(this);
    }
    setMenu(menu) { this.menu = menu; }
    getContentSize() { return this.size; }
    isDestroyed() { return false; }
    loadURL(url) { return this.webContents.loadURL(url); }
    destroy() {}
    show() {}
  }
  class View {
    constructor() { this.webContents = new Contents(); views.push(this); }
    setBackgroundColor() {}
    setVisible() {}
    setBounds(bounds) { this.bounds = bounds; }
  }
  const display = { workAreaSize: { width: 1920, height: 1080 } };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return {
      app: { quit() {} }, BrowserWindow: Window, WebContentsView: View,
      Menu: { setApplicationMenu: (menu) => menus.push(menu) },
      screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    };
    return originalLoad.call(this, name, ...args);
  };
  let WindowManager;
  try { ({ WindowManager } = require('../src/Main/Manager/WindowManager.ts')); }
  finally { Module._load = originalLoad; }
  const manager = new WindowManager('http://127.0.0.1:4173/');
  assert.equal((await manager.initialize()).ok, true);
  manager.createTab();
  manager.openQueueWindow();
  assert.deepEqual(menus, [null]);
  assert.equal(windows.length, 2);
  for (const win of windows) {
    assert.equal(win.menu, null);
    assert.equal(win.options.titleBarStyle, 'hidden');
    assert.equal(new URL(win.webContents.url).searchParams.get('platform'), process.platform);
  }
  for (const view of views) {
    assert.deepEqual(view.bounds, { x: 0, y: 88, width: 1440, height: 812 });
  }
  windows[0].size = [1200, 720];
  windows[0].emit('resize');
  for (const view of views) {
    assert.deepEqual(view.bounds, { x: 0, y: 88, width: 1200, height: 632 });
  }
  await manager.finalize();
});
