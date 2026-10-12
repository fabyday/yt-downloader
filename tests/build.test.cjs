const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseOptions, packageConfig, verifyBinaries } = require('../scripts/build.cjs');
const { architectures } = require('../scripts/binary-architecture.cjs');
const sources = require('../scripts/binary-sources.json');

test('four explicit native targets and host defaults', () => {
  for (const platform of ['darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    assert.deepEqual(parseOptions([], platform, arch), { platform, arch, dir: false });
    assert.deepEqual(parseOptions(['--platform', platform, '--arch', arch, '--dir'], platform), { platform, arch, dir: true });
    const config = packageConfig({ platform, arch });
    assert.equal(config.directories.output, `dist/${platform}-${arch}`);
    assert.equal(config.extraResources[0].from, `.cache/build-binaries/${platform}-${arch}`);
    assert.equal(config.extraResources[0].to, `binaries/${platform}-${arch}`);
    const source = sources.ffmpeg[`${platform}-${arch}`];
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.match(source.url, /^https:\/\/github.com\//);
    assert.ok(!source.url.includes('/latest/'));
  }
});
test('reject unsupported or mistyped targets before building', () => {
  for (const args of [['--arch', 'ia32'], ['--arch'], ['--unknown'], ['--platform', 'linux'], ['--platform', 'win32']]) {
    assert.throws(() => parseOptions(args, 'darwin', 'arm64'));
  }
});
test('PE, Mach-O and universal CPU detection rejects mismatches', () => {
  const pe = Buffer.alloc(4096);pe.write('MZ');pe.writeUInt32LE(128, 0x3c);pe.write('PE\0\0', 128);
  pe.writeUInt16LE(0x8664, 132);assert.deepEqual(architectures(pe, 'win32'), ['x64']);
  pe.writeUInt16LE(0xaa64, 132);assert.deepEqual(architectures(pe, 'win32'), ['arm64']);
  const macho = Buffer.alloc(4096);macho.writeUInt32LE(0xfeedfacf);macho.writeUInt32LE(0x0100000c, 4);
  assert.deepEqual(architectures(macho, 'darwin'), ['arm64']);
  macho.writeUInt32LE(0x01000007, 4);assert.deepEqual(architectures(macho, 'darwin'), ['x64']);
  const fat = Buffer.alloc(4096);fat.writeUInt32BE(0xcafebabe);fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(architectures(fat, 'darwin'), ['x64', 'arm64']);
  assert.deepEqual(architectures(Buffer.alloc(4096), 'darwin'), []);
});
test('missing or wrong architecture binaries fail packaging', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kawai-build-test-'));
  try {
    assert.throws(() => verifyBinaries({ platform: 'win32', arch: 'x64' }, temporary), /Missing/);
    fs.writeFileSync(path.join(temporary, 'yt-dlp.exe'), Buffer.alloc(4096));
    assert.throws(() => verifyBinaries({ platform: 'win32', arch: 'x64' }, temporary), /architecture mismatch/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test('CI installs pnpm before enabling its cache; no local dependency override', () => {
  // electron-builder merges resource arrays; a legacy default would overwrite native binaries.
  assert.equal(require('../package.json').build.extraResources, undefined);
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
  assert.ok(workflow.indexOf('uses: pnpm/action-setup') < workflow.indexOf('uses: actions/setup-node'));
  const workspace = fs.readFileSync(path.join(__dirname, '../pnpm-workspace.yaml'), 'utf8');
  const lock = fs.readFileSync(path.join(__dirname, '../pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(workspace + lock, /link:|D:\//);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(require('../package.json').scripts.dev, /^pnpm run binaries:prepare &&/);
});
