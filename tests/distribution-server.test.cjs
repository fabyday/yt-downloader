const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { resolveOptions, createDistributionServer } = require('../scripts/serve-distribution.cjs');
const pkg = require('../package.json');

test('server chooses the built native installer and rejects invalid targets/ports', () => {
  assert.match(resolveOptions({ os: 'darwin', arch: 'arm64' }).artifact, /darwin-arm64[/\\]kawai-downloader-.*-mac-arm64\.dmg$/);
  assert.match(resolveOptions({ os: 'win32', arch: 'x64' }).artifact, /win32-x64[/\\]kawai-downloader-.*-win-x64-Setup\.exe$/);
  for (const options of [{ port: '0' }, { port: '80' }, { port: '65536' }, { os: 'linux' }, { arch: 'typo' }, { os: 'win32', artifact: '/tmp/app.dmg' }])
    assert.throws(() => resolveOptions(options));
});

test('local server uses release v1 metadata and serves only explicit files with matching hashes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'downloader-server-'));
  const file = path.join(directory, 'app.dmg'), bytes = Buffer.from('local installer fixture');
  await fs.writeFile(file, bytes);
  const { server } = await createDistributionServer({ artifact: file, os: 'darwin', arch: 'arm64' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(origin + '/kawaikara.manifest.json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const manifest = await response.json();
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.connection.protocolVersion, 1);
    assert.equal(manifest.id, pkg.build.appId);
    assert.equal(manifest.targets[0].version, pkg.version);
    assert.equal(manifest.targets[0].artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(await (await fetch(new URL(manifest.targets[0].artifact.url, origin))).text(), bytes.toString());
    const icon = await fetch(new URL(manifest.icon, origin));
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await icon.arrayBuffer()).equals(await fs.readFile(path.join(__dirname, '../resources/app-icon.png'))));
    assert.equal((await fetch(new URL(manifest.guideUrl, origin))).status, 200);
    assert.equal((await fetch(origin + '/../package.json')).status, 404);
    assert.equal((await fetch(origin + '/kawaikara.manifest.json', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});

test('missing local build gives an actionable error before listening', async () => {
  await assert.rejects(createDistributionServer({ artifact: path.join(os.tmpdir(), 'missing-downloader-test.dmg'), os: 'darwin', arch: 'arm64' }), /Run pnpm build first/);
});
