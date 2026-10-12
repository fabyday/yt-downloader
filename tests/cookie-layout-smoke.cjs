// Real pointer input + per-frame geometry; cookie extraction/permissions are mocked.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app, BrowserWindow } = require('electron');
if (process.argv.includes('--software')) app.disableHardwareAcceleration();
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: true, width: 1100, height: 800 });
  const js = code => win.webContents.executeJavaScript(code);
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&platform=darwin`);
  await js(`new Promise(resolve => { const id = setInterval(() => {
    if (document.querySelector('#openPreferenceOverlayButton')) { clearInterval(id); resolve(); }
  }, 30); })`);
  await js(`(async () => {
    const info = await window.ytClipper.getAppInfo();
    window.ytClipper.getAppInfo = async () => ({ ...info, platform: 'darwin', isPackaged: false,
      runtimeAppPath: '/project/node_modules/electron/dist/Electron.app' });
    window.ytClipper.importBrowserCookies = () => new Promise((resolve, reject) => {
      window.finishImport = fail => fail ? reject(new Error('cookies.keychainAccessFailed')) : resolve({ configured: true, count: 2 });
    });
    window.ytClipper.importCookies = () => new Promise(resolve => {
      window.finishImport = cancelled => resolve(cancelled ? null : { configured: true, count: 2 });
    });
    window.openedPermissions = [];
    window.accessRequests = 0;
    window.ytClipper.requestCookieAccess = async () => { window.accessRequests++; };
    window.ytClipper.openCookiePermissionSettings = async target => { window.openedPermissions.push(target); };
    document.querySelector('#openPreferenceOverlayButton').click();
  })()`);
  await new Promise(r => setTimeout(r, 700));
  await js(`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Cookies').click()`);
  await new Promise(r => setTimeout(r, 100));
  for (const [action, fail] of [['browser', true], ['browser', false], ['file', true], ['file', false]]) {
    const point = await js(`(() => {
      const button = document.querySelectorAll('.cookie-actions button')[${action === 'browser' ? 0 : 1}];
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      window.layoutFrames = [];
      window.trackLayout = true;
      const sample = () => {
        const rects = ['.preference-overlay-panel', '.preference-cookies', '.cookie-actions', '.cookie-feedback'].map(selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
        window.layoutFrames.push(rects.flat());
        if (window.trackLayout) requestAnimationFrame(sample);
      }; sample();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    const crop = { x: 150, y: 65, width: 700, height: 60 };
    const baseline = (await win.webContents.capturePage(crop)).toBitmap();
    const assertStablePixels = async () => {
      assert.ok(baseline.equals((await win.webContents.capturePage(crop)).toBitmap()), 'Static header flickered');
    };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await new Promise(r => setTimeout(r, 80));
    await assertStablePixels();
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await new Promise(r => setTimeout(r, 250));
    await assertStablePixels();
    await js(`window.finishImport(${fail})`);
    await new Promise(r => setTimeout(r, 350));
    await assertStablePixels();
    const result = await js(`(() => {
      window.trackLayout = false;
      const base = window.layoutFrames[0];
      const movement = Math.max(...window.layoutFrames.flatMap(frame => frame.map((n, i) => Math.abs(n - base[i]))));
      return { frames: window.layoutFrames.length, movement,
        ...(movement >= 1 ? { base, shifted: window.layoutFrames.find(frame => frame.some((n, i) => Math.abs(n - base[i]) >= 1)) } : {}),
        message: document.querySelector('.cookie-feedback').textContent };
    })()`);
    console.log(JSON.stringify({ action, fail, ...result }));
    assert.ok(result.frames > 3);
    assert.ok(result.movement < 1, `Layout moved ${result.movement}px`);
    if (fail && action === 'browser') assert.match(result.message, /Keychain/);
  }
  const permissions = await js(`(async () => {
    const buttons = [...document.querySelectorAll('.cookie-permission-help button')];
    buttons.find(el => el.textContent === 'Open Keychain Access').click();
    buttons.find(el => el.textContent === 'Open app location & file permissions').click();
    await new Promise(r => setTimeout(r, 50));
    return window.openedPermissions;
  })()`);
  assert.deepEqual(permissions, ['keychain', 'files']);
  const access = await js(`(async () => {
    window.authorizedImports = 0;
    window.ytClipper.importBrowserCookies = async () => {
      if (window.accessRequests !== 1) throw new Error('Extraction before authorization');
      window.authorizedImports++;
      return { configured: true, count: 3 };
    };
    [...document.querySelectorAll('.cookie-permission-help button')].find(el => el.textContent === 'Authorize & extract').click();
    await new Promise(r => setTimeout(r, 50));
    return { count: window.accessRequests, imports: window.authorizedImports,
      devPath: document.querySelector('.cookie-runtime-path').textContent,
      message: document.querySelector('.cookie-feedback').textContent };
  })()`);
  assert.equal(access.count, 1);
  assert.equal(access.imports, 1);
  assert.match(access.devPath, /Electron.app/);
  assert.match(access.message, /extraction completed/);
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
