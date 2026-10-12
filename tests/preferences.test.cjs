const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CookieStore, normalizeCookieFile } = require('../src/Worker/CookieStore.ts');
const { hasBrowserProcess } = require('../src/Worker/BrowserProcess.ts');
const { normalizeShortcuts, DEFAULT_SHORTCUTS, shortcutFromEvent } = require('../src/Shared/shortcuts.ts');

test('cookie status can recover after a damaged file and accepts session cookies and provider records', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kawai-preferences-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new CookieStore(dir);
  await fs.writeFile(path.join(dir, 'youtube-cookies.txt'), 'invalid');
  assert.deepEqual(await store.getStatus(), { configured: false, count: 0, error: 'cookies.readFailed' });
  await assert.rejects(store.createSnapshot(), /cookies.readFailed/);
  await store.clear();
  assert.deepEqual(await store.getStatus(), { configured: false, count: 0 });
  const session = normalizeCookieFile('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t\tSID\tfixture\n');
  assert.equal(session.count, 1);
  assert.match(session.contents, /\t0\tSID/);
  await store.importData({ format: 'records', cookies: [
    { domain: '.youtube.com', name: 'SID', value: 'fixture', httpOnly: true, secure: true },
    { domain: '.unrelated.test', name: 'other', value: 'fixture' },
  ] });
  assert.deepEqual(await store.getStatus(), { configured: true, count: 1 });
  await assert.rejects(async () => store.importData({ format: 'records', cookies: [{ domain: '.youtube.com', name: 'x', value: 'bad\nvalue' }] }), /cookies.invalid/);
  assert.equal((await store.getStatus()).count, 1);
});

test('browser checks include helpers and Windows executables without matching other apps', () => {
  assert.equal(hasBrowserProcess('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n', 'darwin'), true);
  assert.equal(hasBrowserProcess('chrome', '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer)\n', 'darwin'), true);
  assert.equal(hasBrowserProcess('chrome', '"chrome.exe","123","Console"\n', 'win32'), true);
  assert.equal(hasBrowserProcess('chrome', '"msedge.exe","123"\n', 'win32'), false);
  assert.equal(hasBrowserProcess('chrome', '/Applications/kawai-downloader.app/Contents/MacOS/kawai-downloader', 'darwin'), false);
});

test('shortcut persistence keeps defaults, canonicalizes modifiers and removes duplicate bindings', () => {
  assert.deepEqual(normalizeShortcuts(undefined), DEFAULT_SHORTCUTS);
  const edited = normalizeShortcuts({ ...DEFAULT_SHORTCUTS, smallBack: 'K', smallForward: 'K', setEnd: 'Shift+Alt+L' });
  assert.equal(edited.smallBack, 'K');
  assert.equal(edited.smallForward, '');
  assert.equal(edited.setEnd, 'Alt+Shift+L');
  assert.deepEqual(normalizeShortcuts(JSON.parse(JSON.stringify(edited))), edited);
  for (const isMac of [true, false]) {
    const event = { key: 'l', code: 'KeyL', metaKey: isMac, ctrlKey: !isMac, altKey: false, shiftKey: false };
    assert.equal(shortcutFromEvent(event, isMac), 'CmdOrCtrl+L');
    assert.equal(shortcutFromEvent(event, !isMac), isMac ? null : 'Ctrl+L');
  }
});
