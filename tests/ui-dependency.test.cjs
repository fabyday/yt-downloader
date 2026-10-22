const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('KawaiUI installs from an immutable remote commit without a local archive', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependency = pkg.dependencies['@kawaikara/kawai-ui'];
  assert.match(dependency, /^github:Kawaikara\/KawaiUi#[a-f0-9]{40}$/);
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes(`specifier: ${dependency}`));
  assert.ok(!lock.includes('file:vendor/kawai-ui-'));
});
