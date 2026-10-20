const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const script = path.resolve(__dirname, '../install-mac.sh');

function bash(code, args = [], env = {}) {
  return spawnSync('/bin/bash', ['-c', 'source "$1"; shift; ' + code, 'installer-test', script, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000,
  });
}

test('mac installer syntax/help and strict version arguments', {skip: process.platform === 'win32'}, () => {
  assert.equal(spawnSync('/bin/bash', ['-n', script]).status, 0);
  assert.match(spawnSync('/bin/bash', [script, '--help'], {encoding:'utf8'}).stdout, /keep-quarantine/);
  for (const version of ['0.1.0', 'v1.2.3', '1.2.3-beta.1', '1.2.3+build.5']) {
    const result = bash('normalize_version "$1"', [version]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, version.replace(/^v/, ''));
  }
  for (const version of ['../secret', '1.2', '01.2.3', '1.0.0-01', '1.0.0;echo bad', '1.2.3\nother']) {
    assert.notEqual(bash('normalize_version "$1"', [version]).status, 0);
  }
  assert.notEqual(spawnSync('/bin/bash', [script, '--unknown']).status, 0);
  assert.notEqual(spawnSync('/bin/bash', [script, '--version', '']).status, 0);
  for (const [arm, machine, expected] of [['1','arm64','arm64'],['1','x86_64','arm64'],['0','x86_64','x64'],['','arm64','arm64']]) {
    assert.equal(bash('mac_arch "$1" "$2"',[arm,machine]).stdout,expected);
  }
  assert.notEqual(bash('mac_arch "$1" "$2"',['0','ppc']).status,0);
});

test('offline mac installation verifies release, backs up app, scopes quarantine removal, and preserves old app on failure',
  {skip: process.platform !== 'darwin' || process.getuid?.() === 0}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawai-installer-test-'));
  try {
    const app = path.join(root, 'kawai-downloader.app');
    fs.mkdirSync(path.join(app, 'Contents/MacOS'), {recursive:true});
    fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents/MacOS/fixture'));
    fs.chmodSync(path.join(app, 'Contents/MacOS/fixture'), 0o755);
    fs.mkdirSync(path.join(app,'Contents/Frameworks/Fixture.framework/Versions/A'),{recursive:true});
    fs.symlinkSync('A',path.join(app,'Contents/Frameworks/Fixture.framework/Versions/Current'));
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0"><dict><key>CFBundleIdentifier</key><string>day.faby.kawai-downloader</string>
      <key>CFBundleShortVersionString</key><string>1.2.3</string>
      <key>CFBundleExecutable</key><string>fixture</string></dict></plist>`);
    const fixturePlist = path.join(app,'Contents/Info.plist');
    execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;InstallerFixture;', fixturePlist]);
    execFileSync('/usr/bin/xattr', ['-w', 'day.faby.fixture', 'preserve-this', fixturePlist]);
    const zip = path.join(root, 'fixture.zip');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--extattr', '--qtn', '--sequesterRsrc', '--keepParent', app, zip]);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    const manifest = {version:'1.2.3',artifacts:['arm64','x64'].map(arch=>({platform:'darwin',arch,kind:'zip',
      url:`https://github.com/fabyday/yt-downloader/releases/download/v1.2.3/kawai-downloader-1.2.3-mac-${arch}.zip`,sha256}))};
    const manifestPath=path.join(root,'manifest.json'), log=path.join(root,'requests.log');
    fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    const destination=path.join(root,'Applications with spaces'), target=path.join(destination,'kawai-downloader.app');
    fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'old-app'),'original');
    const env={INSTALL_FIXTURE_MANIFEST:manifestPath,INSTALL_FIXTURE_ZIP:zip,INSTALL_FIXTURE_LOG:log};
    const run = (...args) => bash(`download() {
      printf '%s\\n' "$1" >> "$INSTALL_FIXTURE_LOG"
      case "$1" in
        */release-manifest.json) /bin/cp "$INSTALL_FIXTURE_MANIFEST" "$2" ;;
        *.zip) /bin/cp "$INSTALL_FIXTURE_ZIP" "$2" ;;
        *) return 1 ;;
      esac
    }; main "$@"`, ['--dir',destination,...args],env);
    const result=run();
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    assert.match(fs.readFileSync(log,'utf8'),/releases\/latest\/download\/release-manifest.json/);
    assert.ok(fs.existsSync(path.join(target,'Contents/Info.plist')));
    assert.equal(spawnSync('/usr/bin/xattr',['-p','com.apple.quarantine',path.join(target,'Contents/Info.plist')]).status,1);
    assert.equal(execFileSync('/usr/bin/xattr',['-p','day.faby.fixture',path.join(target,'Contents/Info.plist')],{encoding:'utf8'}).trim(),'preserve-this');
    const backup=fs.readdirSync(destination).find(name=>name.startsWith('.kawai-downloader-backup.'));
    assert.equal(fs.readFileSync(path.join(destination,backup,'kawai-downloader.app/old-app'),'utf8'),'original');
    assert.ok(!fs.readdirSync(destination).some(name=>name.startsWith('.kawai-install.')));
    const versioned=run('--version','v1.2.3','--keep-quarantine');
    assert.equal(versioned.status,0,versioned.stderr);
    assert.doesNotMatch(versioned.stdout,/Removing quarantine/);
    assert.equal(spawnSync('/usr/bin/xattr',['-p','com.apple.quarantine',path.join(target,'Contents/Info.plist')]).status,0);
    assert.equal(fs.readlinkSync(path.join(target,'Contents/Frameworks/Fixture.framework/Versions/Current')),'A');
    assert.match(fs.readFileSync(log,'utf8'),/releases\/download\/v1.2.3\/release-manifest.json/);
    manifest.artifacts.forEach(item=>{item.sha256='0'.repeat(64);});fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    const badHash=run('1.2.3');
    assert.notEqual(badHash.status,0);assert.match(badHash.stderr,/SHA-256 mismatch/);
    assert.ok(fs.existsSync(path.join(target,'Contents/Info.plist')));
    const badVersion=run('1.2.4');
    assert.notEqual(badVersion.status,0);assert.match(badVersion.stderr,/versions differ/);
    manifest.artifacts.forEach(item=>{item.sha256=sha256;item.url='https://attacker.example/app.zip';});
    fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    const badUrl=run('1.2.3');
    assert.notEqual(badUrl.status,0);assert.match(badUrl.stderr,/Unexpected artifact URL/);
    manifest.artifacts=[];fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    const missing=run('1.2.3');
    assert.notEqual(missing.status,0);assert.match(missing.stderr,/exactly one/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
