const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseVersion, compareVersions, assertNewVersion, checkRemote, collectAssets, publishRelease } = require('../scripts/release.cjs');

test('strict SemVer ordering including prerelease and build metadata', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  ordered.forEach((version, i) => {
    assert.equal(compareVersions(version, version), 0);
    if (i) {
      assert.equal(compareVersions(ordered[i - 1], version), -1);
      assert.equal(compareVersions(version, ordered[i - 1]), 1);
    }
  });
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  for (const value of ['v1.0.0', '01.0.0', '1.0', '1.0.0-01', '1.0.0\ninjected', undefined]) assert.throws(() => parseVersion(value));
});

test('first release allowed; same or lower version rejected against tags and drafts', () => {
  assert.doesNotThrow(() => assertNewVersion('0.1.0', []));
  assert.doesNotThrow(() => assertNewVersion('2.0.0', ['unrelated-tag', 'v1.9.9']));
  for (const version of ['1.0.0', '0.9.0', '1.0.0+new']) assert.throws(() => assertNewVersion(version, ['v1.0.0']), /must be newer/);
  const calls = [];
  const run = args => {
    calls.push(args);
    return JSON.stringify(args.at(-1).includes('/tags?') ? [[{ name: 'v0.1.0' }], [{ name: 'v0.2.0' }]] : [[{ tag_name: 'v0.3.0', draft: true }]]);
  };
  assert.throws(() => checkRemote('owner/repo', '0.3.0', run), /must be newer/);
  assert.ok(calls.every(args => args.includes('--paginate') && args.includes('--slurp')));
  assert.throws(() => checkRemote('owner/repo', '1.0.0', () => { throw new Error('403'); }), /403/);
});

test('release requires all eight installers and combines four targets with version-pinned hashes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kawai-release-test-'));
  try {
    await assert.rejects(collectAssets(directory, '1.2.3', 'owner/repo'));
    for (const platform of ['darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
      const folder = path.join(directory, `kawai-downloader-${platform}-${arch}`);
      fs.mkdirSync(folder);
      for (const suffix of platform === 'darwin' ? ['dmg', 'zip'] : ['Setup.exe', 'Portable.exe']) {
        const filename = platform === 'darwin' ? `kawai-downloader-1.2.3-mac-${arch}.${suffix}` : `kawai-downloader-1.2.3-win-${arch}-${suffix}`;
        fs.writeFileSync(path.join(folder, filename), 'installer fixture');
      }
    }
    const { files, manifest } = await collectAssets(directory, '1.2.3', 'owner/repo');
    assert.equal(files.length, 8);
    assert.equal(new Set(files.map(file => path.basename(file))).size, 8);
    assert.equal(manifest.artifacts.length, 8);
    for (const artifact of manifest.artifacts) {
      assert.match(artifact.url, /^https:\/\/github.com\/owner\/repo\/releases\/download\/v1.2.3\//);
      assert.equal(artifact.sha256, crypto.createHash('sha256').update('installer fixture').digest('hex'));
    }
    const calls = [];
    const run = args => { calls.push(args); return args.includes('--paginate') ? '[[]]' : 'https://github.com/owner/repo/releases/draft'; };
    const sha = 'a'.repeat(40);
    await publishRelease('owner/repo', '1.2.3', sha, directory, run);
    assert.equal(calls.length, 4);
    assert.ok(calls[2].includes(`sha=${sha}`));
    assert.ok(calls[2].includes('ref=refs/tags/v1.2.3'));
    assert.ok(calls[3].includes('--draft'));
    assert.ok(calls[3].includes('--verify-tag'));
    assert.ok(files.every(file => calls[3].includes(file)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'))).artifacts.length, 8);
    const raced = [];
    await assert.rejects(publishRelease('owner/repo', '1.2.3', sha, directory, args => {
      raced.push(args);
      return args.at(-1).includes('/tags?') ? '[[{"name":"v1.2.3"}]]' : '[[]]';
    }), /must be newer/);
    assert.ok(raced.every(args => args.includes('--paginate')));
    await assert.rejects(publishRelease('owner/repo', '1.2.3', sha, directory, args => {
      if (args[0] === 'release') throw new Error('Upload failed');
      return args.includes('--paginate') ? '[[]]' : '{}';
    }), /Upload failed/);
    fs.writeFileSync(files[0], '');
    await assert.rejects(collectAssets(directory, '1.2.3', 'owner/repo'), /invalid installer/);
    await assert.rejects(publishRelease('owner/repo', '1.2.3', sha, directory, () => assert.fail('Must not access API with missing assets')), /invalid installer/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('manual release pipeline pins SHA and waits for all targets without cancelling active releases', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /ref: \$\{\{ needs.validate.outputs.sha \}\}/);
  assert.match(workflow, /needs: \[validate, package\]/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /merge-multiple: false/);
  const script = fs.readFileSync(path.join(__dirname, '../scripts/release.cjs'), 'utf8');
  assert.match(script, /'--verify-tag'/);
  assert.match(script, /'--draft'/);
  assert.doesNotMatch(script, /'--latest'|'--force'/);
});
