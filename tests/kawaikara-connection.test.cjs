const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { KawaikaraConnection } = require('../src/Main/KawaikaraConnection.ts');

async function fixture(t, packaged = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kawaikara-target-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [], clients = [];
  let wakes = 0;
  const create = (file, directory) => {
    const client = { file, directory, state: 'waiting',
      status() { return { development: true, state: this.state }; },
      async start() { calls.push(['start', directory]); },
      async connect() { calls.push(['connect', directory]); return this.status(); },
      async setAutomatic() {},
      async disconnect() { calls.push(['revoke', directory]); this.state = 'disconnected'; },
      async dispose() { calls.push(['dispose', directory]); },
    };
    clients.push(client); return client;
  };
  const service = () => new KawaikaraConnection(path.join(root, 'profile'), packaged, create, async () => { wakes++; });
  const checkout = async name => {
    const location = path.join(root, name); await fs.mkdir(location);
    await fs.writeFile(path.join(location, 'package.json'), JSON.stringify({ name: 'kawaikara' }));
    return location;
  };
  return { root, calls, clients, service, checkout, wakes: () => wakes };
}

test('plain DEV never wakes the installed protocol without explicit selection', async t => {
  const f = await fixture(t), connection = f.service();
  await connection.start();
  assert.equal(connection.status().requiresDirectory, true);
  assert.equal(await connection.open(), false);
  assert.equal(f.wakes(), 0);
  assert.equal((await connection.connect()).development, true);
  await connection.useInstalled();
  assert.equal(await connection.open(), true);
  assert.equal(f.wakes(), 1);
});

test('checkout choice persists, isolates credentials, and revokes the previous target before switching', async t => {
  const f = await fixture(t), a = await f.checkout('DEV A'), b = await f.checkout('DEV B');
  let connection = f.service(); await connection.start();
  await connection.selectCheckout(a);
  const identityA = f.clients.at(-1).file;
  assert.equal(connection.status().directory, path.join(a, 'tmp', 'development-connections'));
  assert.equal(await connection.open(), false);
  assert.equal(f.wakes(), 0);
  await connection.dispose();
  connection = f.service(); await connection.start();
  assert.equal(f.clients.at(-1).file, identityA);
  await connection.selectCheckout(b);
  assert.notEqual(f.clients.at(-1).file, identityA);
  assert.ok(f.calls.find(item => item[0] === 'revoke' && item[1].includes('DEV A')));
  assert.equal(f.wakes(), 0);
  const before = connection.status().directory;
  await assert.rejects(connection.selectCheckout(f.root));
  assert.equal(connection.status().directory, before);
  await connection.dispose();
});

test('packaged downloader can explicitly select DEV and must not fall back when DEV is offline', async t => {
  const f = await fixture(t, true), connection = f.service(), checkout = await f.checkout('host');
  await connection.start();
  assert.equal(connection.status().development, false);
  await connection.selectCheckout(checkout);
  assert.equal(connection.status().development, true);
  assert.equal(await connection.open(), false);
  assert.equal(f.wakes(), 0);
  await connection.dispose();
  const restored = f.service(); await restored.start();
  assert.equal(restored.status().development, true);
  assert.equal(await restored.open(), false);
  assert.equal(f.wakes(), 0);
  await restored.dispose();
});

test('explicit directory overrides remembered installed mode and can be remembered by selecting the same checkout', async t => {
  const f = await fixture(t, true), checkout = await f.checkout('override');
  const connection = f.service();
  await connection.start(path.join(checkout, 'tmp', 'development-connections'));
  await connection.selectCheckout(checkout);
  await connection.dispose();
  const restored = f.service(); await restored.start();
  assert.equal(restored.status().directory, path.join(checkout, 'tmp', 'development-connections'));
  assert.equal(f.wakes(), 0);
  await restored.dispose();
  await assert.rejects(f.service().start('relative'), /absolute/);
});
