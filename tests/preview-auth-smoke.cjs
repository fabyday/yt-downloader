require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { app, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { IPCManager } = require('../src/Main/Manager/IPCManager.ts');
const { CookieStore } = require('../src/Worker/CookieStore.ts');
const { PREVIEW_PARTITION } = require('../src/Main/PreviewCookies.ts');
app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kawai-preview-auth-'));
  const store = new CookieStore(directory);
  const contents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture\n.google.com\tTRUE\t/\tTRUE\t0\tSID\tgoogle-fixture\n';
  await store.import(contents);
  const worker = {getClient: () => ({request: (method, params) => {
    if (method === 'cookies.status') return store.getStatus();
    if (method === 'cookies.preview') return store.getPreviewContents();
    if (method === 'cookies.import') return store.import(params.contents);
    throw new Error('Unexpected method');
  }}), onQueueChanged: () => () => {}};
  const broadcasts = [];
  const manager = new IPCManager(worker, {broadcast: (channel, payload) => broadcasts.push({channel, payload})}, {}, {}, {});
  try {
    assert.equal((await manager.initialize()).ok, true);
    const target = session.fromPartition(PREVIEW_PARTITION);
    assert.equal((await target.cookies.get({domain:'youtube.com'})).length, 1);
    assert.equal((await target.cookies.get({domain:'google.com'})).length, 0);
    await target.cookies.set({url:'https://youtube.com/', domain:'.youtube.com', name:'SID', value:'rotated-fixture', secure:true, sameSite:'no_restriction'});
    await new Promise(resolve => setTimeout(resolve, 800));
    await manager.cookieOperations;
    assert.doesNotMatch(await store.getPreviewContents(), /rotated-fixture/);
    assert.match(await store.getPreviewContents(), /google-fixture/);
    assert.equal(broadcasts.length, 0, 'Background rotation must not reload the player');
    const cleared = await manager.updateCookies(() => store.clear());
    assert.equal(cleared.previewApplied, false);
    assert.equal((await target.cookies.get({domain:'youtube.com'})).length, 0);
    assert.equal(broadcasts.at(-1).channel, 'cookies:changed');
    const imported = await manager.updateCookies(() => store.import(contents));
    assert.equal(imported.previewApplied, true);
    assert.equal(imported.previewCount, 1);
    await target.cookies.remove('https://youtube.com/', 'SID');
    assert.match(await store.getPreviewContents(), /SID\tfixture/);
    console.log('Preview auth: startup restore, import, source jar isolation, clear, broadcasts passed');
  } finally { await manager.finalize(); await fs.rm(directory, {recursive:true, force:true}); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
