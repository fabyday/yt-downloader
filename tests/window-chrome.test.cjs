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
  let contentsSequence=0;
  class Contents extends EventEmitter {
    constructor(){super();this.id=++contentsSequence;}
    isDestroyed() { return false; }
    setWindowOpenHandler() {}
    loadURL(url) { this.url = url; this.loads = (this.loads || 0) + 1; this.hasInput = false; return Promise.resolve(); }
    executeJavaScript() { return Promise.resolve(!!this.hasInput); }
    send() {}
    focus() { this.focused=true; }
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
    show() { this.shown=true; }
    isMinimized() { return !!this.minimized; }
    restore() { this.minimized=false; this.restored=true; }
    focus() { this.focused=true; }
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
      app: { quit() {}, focus() {} }, BrowserWindow: Window, WebContentsView: View,
      Menu: { setApplicationMenu: (menu) => menus.push(menu) },
      screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    };
    return originalLoad.call(this, name, ...args);
  };
  let WindowManager;
  try { ({ WindowManager } = require('../src/Main/Manager/WindowManager.ts')); }
  finally { Module._load = originalLoad; }
  const accepted=[];
  const manager = new WindowManager('http://127.0.0.1:4173/',{acceptDeepLink:request=>accepted.push(request)});
  assert.equal((await manager.initialize()).ok, true);
  manager.createTab();
  manager.openQueueWindow();
  assert.deepEqual(menus, [null]);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].options.minWidth,1100);
  assert.equal(windows[0].options.minHeight,820);
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
  const external = (url, requestId='request-0001') => {
    const link=new URL('yt-downloader://open');
    link.searchParams.set('url',url);link.searchParams.set('requestId',requestId);
    link.searchParams.set('callback','http://127.0.0.1:12345/callback');link.searchParams.set('token','x'.repeat(32));
    return link.href;
  };
  windows[0].minimized=true;
  assert.equal(manager.openExternalUrl(external('https://youtu.be/woyNiKxoDS4')),true);
  const first=manager.getTabSnapshot();
  assert.equal(first.tabs.length,3);
  assert.equal(first.activeTabId,first.tabs.at(-1).id);
  assert.ok(windows[0].restored&&windows[0].shown&&windows[0].focused);
  assert.equal(views.at(-1).webContents.focused,true);
  manager.openExternalUrl(external('https://www.youtube.com/watch?v=woyNiKxoDS4&t=12','request-0002'));
  assert.equal(manager.getTabSnapshot().tabs.length,3,'same video with another URL reuses its tab');
  assert.equal(manager.getTabSnapshot().activeTabId,first.activeTabId);
  const contents=views.at(-1).webContents;
  const item={payload:{url:'https://youtu.be/woyNiKxoDS4'},companionRequestId:'request-0001'};
  assert.equal(manager.bindCompanionRequest(contents.id,item).companionRequestId,'request-0002');
  manager.updateTabTitle(contents.id,'Manually replaced','ip7NSleQ8_U');
  assert.equal(manager.bindCompanionRequest(contents.id,item).companionRequestId,undefined);
  manager.openExternalUrl(external('https://youtu.be/ip7NSleQ8_U'));
  assert.equal(manager.getTabSnapshot().tabs.length,3,'manual source changes update the identity');
  manager.openExternalUrl(external('https://youtu.be/woyNiKxoDS4'));
  assert.equal(manager.getTabSnapshot().tabs.length,4,'old source gets a new tab after replacement');
  for(let i=0;i<12;i++) manager.openExternalUrl(external('https://chzzk.naver.com/video/'+(100+i)));
  assert.equal(manager.getTabSnapshot().tabs.length,16,'external requests do not disappear at the former 12-tab limit');
  assert.equal(manager.getTabSnapshot().activeTabId,manager.getTabSnapshot().tabs.at(-1).id);
  assert.equal(manager.openExternalUrl('https://example.com'),false);
  for (const tab of manager.getTabSnapshot().tabs.slice(0, -1)) await manager.closeTab(tab.id);
  const last = manager.getTabSnapshot().tabs[0];
  const lastView = views.at(-1);
  const viewCount = views.length;
  const loads = lastView.webContents.loads;
  await Promise.all([manager.closeTab(last.id), manager.closeTab(last.id)]);
  assert.equal(manager.getTabSnapshot().tabs.length, 1);
  assert.equal(manager.getTabSnapshot().activeTabId, last.id);
  assert.equal(views.length, viewCount, 'reset must reuse the existing view');
  assert.equal(lastView.webContents.loads, loads + 1, 'rapid double close resets only once');
  assert.equal(new URL(lastView.webContents.url).searchParams.has('sourceUrl'), false);
  assert.equal(manager.companionRequestFor(lastView.webContents.id, 'https://chzzk.naver.com/video/111'), undefined);
  for (let i = 0; i < 5; i++) await manager.closeTab(last.id);
  assert.equal(lastView.webContents.loads, loads + 1, 'blank last tab must not reload');
  assert.equal(manager.getTabSnapshot().tabs[0].title, 'Video 1');
  lastView.webContents.hasInput = true;
  await manager.closeTab(last.id);
  assert.equal(lastView.webContents.loads, loads + 2, 'typed but unloaded URLs also reset');
  assert.equal(views.length, viewCount);
  await manager.finalize();
});
