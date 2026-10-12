const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {prepareBinaries}=require('../scripts/prepare-binaries.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');

test('cold preparation, offline reuse, corruption repair and atomic failure preserve usable files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-binary-preparation-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  // Fixture Mach-O headers; no external executables or network are run.
  const binary=Buffer.alloc(4096);binary.writeUInt32LE(0xfeedfacf);binary.writeUInt32LE(0x0100000c,4);
  const source={url:'https://fixtures.invalid/native',sha256:hash(binary)};
  const sources={'yt-dlp':{darwin:source},ffmpeg:{'darwin-arm64':source},'ffmpeg-notices':{'darwin-arm64':[]}};
  let calls=0;
  const configuration={root,sources,fetch:async()=>{calls++;return new Response(binary);}};
  const options={platform:'darwin',arch:'arm64'};
  const output=await prepareBinaries(options,configuration);
  assert.equal(calls,1);
  const file=path.join(output,'ffmpeg'),before=await fs.stat(file);
  const offline={...configuration,fetch:async()=>{throw Error('offline');}};
  assert.equal(await prepareBinaries(options,offline),output);
  assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs,'never rewrite a running valid executable');
  await fs.writeFile(file,'corrupt');
  await prepareBinaries(options,offline);
  assert.deepEqual(await fs.readFile(file),binary,'repair from verified download cache');
  // New manifest with a broken upstream download must not touch the current files.
  sources.ffmpeg['darwin-arm64']={url:'https://fixtures.invalid/new',sha256:hash('new')};
  await assert.rejects(prepareBinaries(options,configuration),/SHA-256 mismatch/);
  assert.deepEqual(await fs.readFile(file),binary);
  assert.ok(!(await fs.readdir(path.join(root,'.cache/build-binaries/downloads'))).some(f=>f.endsWith('.part')));
});
