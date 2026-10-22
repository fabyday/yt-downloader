const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { connectionDirectory } = require('../scripts/start-connected.cjs');
test('connected start selects the requested checkout including paths with spaces', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaikara checkout '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'kawaikara' }));
  assert.equal(connectionDirectory(root), path.join(root, 'tmp', 'development-connections'));
  assert.equal(fs.existsSync(path.join(root, 'tmp')), false);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'other' }));
  assert.throws(() => connectionDirectory(root), /Kawaikara checkout/);
  assert.throws(() => connectionDirectory(), /--kawaikara/);
});
