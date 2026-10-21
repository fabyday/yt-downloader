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


function github({ previous = false, published = false, orphan = false, before, after } = {}) {
  let sequence = 10;
  const releases = new Map(previous ? [[1, { id: 1, tag_name: 'v1.2.3', draft: !published, updated_at: 'old', body: 'Reviewer notes\nKeep these.', assets: [{ name: 'old.zip' }], html_url: 'https://github.com/owner/repo/releases/1' }]] : []);
  const tags = new Map(previous || orphan ? [['v1.2.3', 'b'.repeat(40)]] : []);
  const events = [];
  const state = { releases, tags, events };
  function run(args) {
    const resource = args.find(value => value.startsWith('repos/'));
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
    const fields = {};
    args.forEach((arg, i) => { if (arg === '-f' || arg === '-F') { const value = args[i + 1], split = value.indexOf('='); fields[value.slice(0, split)] = arg === '-F' ? value.slice(split + 1) === 'true' : value.slice(split + 1); } });
    events.push({ method, resource, args: [...args], fields });
    before?.({ method, resource, args, fields }, state);
    let result;
    if (args[0] === 'release' && args[1] === 'upload') {
      const release = [...releases.values()].find(item => item.tag_name === args[2]);
      release.assets = args.slice(5).map(file => ({ name: path.basename(file), size: fs.statSync(file).size, state: 'uploaded', digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
      release.updated_at = String(sequence++);
      result = '';
    } else if (args.includes('--paginate')) {
      if (resource.includes('/tags?')) result = [[...tags.keys()].map(name => ({ name }))];
      else if (resource.includes('/assets?')) result = [[...releases.get(Number(resource.match(/releases\/(\d+)/)[1])).assets]];
      else result = [[...releases.values()]];
    } else if (resource.endsWith('/releases/generate-notes')) result = { body: 'Generated notes' };
    else if (resource.endsWith('/releases') && method === 'POST') {
      const id = sequence++;
      result = { id, ...fields, updated_at: String(sequence++), html_url: `https://github.com/owner/repo/releases/${id}`, assets: [] };
      releases.set(id, result);
    } else if (/\/releases\/\d+$/.test(resource)) {
      const id = Number(resource.split('/').at(-1)), release = releases.get(id);
      assert.ok(release, `Missing release ${id}`);
      if (method === 'PATCH') { assert.equal(release.draft, true); Object.assign(release, fields, { updated_at: String(sequence++) }); }
      if (method === 'DELETE') { assert.equal(release.draft, true); releases.delete(id); result = ''; }
      else result = release;
    } else if (resource.includes('/git/ref/tags/')) {
      const sha = tags.get(resource.split('/tags/')[1]);
      if (!sha) throw new Error('HTTP 404');
      result = { object: { type: 'commit', sha } };
    } else if (resource.endsWith('/git/refs')) {
      const name = fields.ref.replace('refs/tags/', '');
      assert.equal(tags.has(name), false); tags.set(name, fields.sha); result = {};
    } else if (resource.includes('/git/refs/tags/')) {
      const name = resource.split('/tags/')[1];
      if (method === 'DELETE') tags.delete(name); else tags.set(name, fields.sha);
      result = {};
    } else assert.fail(`Unknown API: ${args.join(' ')}`);
    after?.({ method, resource, args, fields, result }, state);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
  return { ...state, run };
}

function installers() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kawai-release-test-'));
  for (const platform of ['darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    const folder = path.join(directory, `kawai-downloader-${platform}-${arch}`);
    fs.mkdirSync(folder);
    for (const suffix of platform === 'darwin' ? ['dmg', 'zip'] : ['Setup.exe', 'Portable.exe']) {
      const name = platform === 'darwin' ? `kawai-downloader-1.2.3-mac-${arch}.${suffix}` : `kawai-downloader-1.2.3-win-${arch}-${suffix}`;
      fs.writeFileSync(path.join(folder, name), 'installer fixture');
    }
  }
  return directory;
}
async function publish(remote, callback) {
  const directory = installers();
  try {
    const result = await publishRelease('owner/repo', '1.2.3', 'a'.repeat(40), directory, remote.run);
    await callback?.(directory);
    return result;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('draft-only tags permit the same version; published and independent tags remain immutable', () => {
  assert.doesNotThrow(() => assertNewVersion('0.1.0', []));
  for (const version of ['1.0.0', '0.9.0', '1.0.0+new']) assert.throws(() => assertNewVersion(version, ['v1.0.0']), /must be newer/);
  const remote = github({ previous: true });
  assert.equal(checkRemote('owner/repo', '1.2.3', remote.run).replacement.id, 1);
  assert.throws(() => checkRemote('owner/repo', '1.2.3', github({ previous: true, published: true }).run), /must be newer/);
  assert.throws(() => checkRemote('owner/repo', '1.2.3', github({ orphan: true }).run), /must be newer/);
  assert.throws(() => checkRemote('owner/repo', '1.2.3', () => { throw new Error('403'); }), /403/);
});

test('first draft pins SHA and verifies all eight installers, two manifests and real icon', async () => {
  const remote = github();
  await publish(remote, directory => {
    const distribution = JSON.parse(fs.readFileSync(path.join(directory, 'kawaikara.manifest.json')));
    assert.equal(distribution.schemaVersion, 1);
    assert.equal(distribution.connection.protocolVersion, 1);
    assert.equal(distribution.id, 'day.faby.kawai-downloader');
    assert.equal(distribution.targets.length, 6);
    assert.equal(distribution.targets.some(target => /Portable/.test(target.artifact.url)), false);
    assert.match(distribution.icon, /releases\/download\/v1.2.3\/kawai-downloader-icon.png$/);
    assert.ok(fs.readFileSync(path.join(directory, 'kawai-downloader-icon.png')).equals(fs.readFileSync(path.join(__dirname, '../resources/app-icon.png'))));
  });
  const release = [...remote.releases.values()][0];
  assert.equal(remote.releases.size, 1);
  assert.equal(release.tag_name, 'v1.2.3');
  assert.equal(release.draft, true);
  assert.equal(release.assets.length, 11);
  assert.equal(remote.tags.get('v1.2.3'), 'a'.repeat(40));
});

test('same-version draft replaced only after complete upload, preserving notes and unrelated drafts', async () => {
  const remote = github({ previous: true });
  remote.releases.set(2, { id: 2, tag_name: 'v9.0.0', draft: true, updated_at: 'other' });
  await publish(remote);
  assert.equal(remote.releases.has(1), false);
  assert.equal(remote.releases.has(2), true);
  const replacement = [...remote.releases.values()].find(item => item.tag_name === 'v1.2.3');
  assert.equal(replacement.body, 'Reviewer notes\nKeep these.');
  assert.equal(replacement.assets.length, 11);
  assert.equal(remote.tags.get('v1.2.3'), 'a'.repeat(40));
  const upload = remote.events.findIndex(event => event.args[1] === 'upload');
  const deletion = remote.events.findIndex(event => event.method === 'DELETE');
  const verify = remote.events.findIndex(event => event.resource?.includes('/assets?'));
  assert.ok(deletion > verify && verify > upload);
});

for (const problem of ['upload', 'digest']) test(`${problem} failure preserves the old draft and tag`, async () => {
  const remote = github({ previous: true,
    before: event => { if (problem === 'upload' && event.args[1] === 'upload') throw new Error('Upload failed'); },
    after: (event, state) => { if (problem === 'digest' && event.args[1] === 'upload') [...state.releases.values()].at(-1).assets[0].digest = 'sha256:wrong'; },
  });
  await assert.rejects(publish(remote), /Upload failed|verification failed/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).tag_name, 'v1.2.3');
  assert.equal(remote.releases.get(1).assets[0].name, 'old.zip');
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('promotion failure restores the old draft and tag', async () => {
  const remote = github({ previous: true, before: event => {
    if (event.method === 'PATCH' && event.resource?.includes('/releases/') && !event.resource.endsWith('/1') && event.fields.tag_name === 'v1.2.3') throw new Error('Promotion failed');
  } });
  await assert.rejects(publish(remote), /Promotion failed/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).tag_name, 'v1.2.3');
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('lost promotion response is reconciled before old draft cleanup', async () => {
  const remote = github({ previous: true, after: event => {
    if (event.method === 'PATCH' && event.resource?.includes('/releases/') && !event.resource.endsWith('/1') && event.fields.tag_name === 'v1.2.3') throw new Error('Lost response');
  } });
  await publish(remote);
  assert.equal(remote.releases.size, 1);
  assert.equal([...remote.releases.values()][0].tag_name, 'v1.2.3');
});

test('publishing the previous draft during upload aborts replacement without touching it', async () => {
  const remote = github({ previous: true, after: (event, state) => {
    if (event.args[1] === 'upload') state.releases.get(1).draft = false;
  } });
  await assert.rejects(publish(remote), /must be newer/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).draft, false);
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('old draft cleanup failure retains a complete replacement and recoverable backup', async () => {
  const remote = github({ previous: true, before: event => {
    if (event.method === 'DELETE' && event.resource.endsWith('/releases/1')) throw new Error('Cleanup failed');
  } });
  await assert.rejects(publish(remote), /Cleanup failed/);
  assert.equal(remote.releases.size, 2);
  assert.match(remote.releases.get(1).tag_name, /^kawai-backup-/);
  assert.equal([...remote.releases.values()].find(item => item.tag_name === 'v1.2.3').assets.length, 11);
});

test('missing installer prevents any remote writes', async () => {
  const directory = installers();
  try {
    const { files } = await collectAssets(directory, '1.2.3', 'owner/repo');
    fs.writeFileSync(files[0], '');
    await assert.rejects(publishRelease('owner/repo', '1.2.3', 'a'.repeat(40), directory, () => assert.fail('Unexpected API access')), /invalid installer/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('manual pipeline pins SHA, waits for every target, and never publishes automatically', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /ref: \$\{\{ needs.validate.outputs.sha \}\}/);
  assert.match(workflow, /needs: \[validate, package\]/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /merge-multiple: false/);
  const script = fs.readFileSync(path.join(__dirname, '../scripts/draft-release.cjs'), 'utf8');
  assert.match(script, /draft: true/);
  assert.doesNotMatch(script, /draft: false|--clobber|--latest/);
});

test('failed first upload never leaves a version tag or incomplete draft', async () => {
  const remote = github({ before: event => { if (event.args[1] === 'upload') throw new Error('Upload failed'); } });
  await assert.rejects(publish(remote), /Upload failed/);
  assert.equal(remote.releases.size, 0);
  assert.equal(remote.tags.size, 0);
});

test('lost tag update response restores the previous SHA and draft', async () => {
  const remote = github({ previous: true, after: event => {
    if (event.method === 'PATCH' && event.resource.includes('/git/refs/') && event.fields.sha === 'a'.repeat(40)) throw new Error('Lost tag response');
  } });
  await assert.rejects(publish(remote), /Lost tag response/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).tag_name, 'v1.2.3');
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('lost backup rename response restores the previous draft without deleting it', async () => {
  const remote = github({ previous: true, after: event => {
    if (event.method === 'PATCH' && event.fields.tag_name?.startsWith('kawai-backup-')) throw new Error('Lost backup response');
  } });
  await assert.rejects(publish(remote), /Lost backup response/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).tag_name, 'v1.2.3');
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('rejected tag update restores the draft even when the ref was never changed', async () => {
  const remote = github({ previous: true, before: event => {
    if (event.method === 'PATCH' && event.resource.includes('/git/refs/')) throw new Error('Tag update denied');
  } });
  await assert.rejects(publish(remote), /Tag update denied/);
  assert.equal(remote.releases.size, 1);
  assert.equal(remote.releases.get(1).tag_name, 'v1.2.3');
  assert.equal(remote.tags.get('v1.2.3'), 'b'.repeat(40));
});

test('rejected first tag creation cleans staging without creating an orphan ref', async () => {
  const remote = github({ before: event => {
    if (event.method === 'POST' && event.resource.endsWith('/git/refs')) throw new Error('Tag creation denied');
  } });
  await assert.rejects(publish(remote), /Tag creation denied/);
  assert.equal(remote.releases.size, 0);
  assert.equal(remote.tags.size, 0);
});
