const { testBinary } = require('./binaries.cjs');
require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {movePlayhead}=require('../src/Shared/selectionMode.ts');
const {parseCustomArgs,customEncodingPreset,EXTRA_PRESETS,PRESET_OPTIONS}=require('../src/Shared/encoding.ts');
const {normalizeDownloadRequest,buildFfmpegArgs}=require('../src/Worker/DownloadEngine.ts');
test('all three modes, directional boundary following and media limits',()=>{
  assert.deepEqual(movePlayhead('clamp',5,100,20,40),{time:20,start:20,end:40});
  assert.deepEqual(movePlayhead('clamp',50,100,20,40),{time:40,start:20,end:40});
  assert.deepEqual(movePlayhead('follow',5,100,20,40),{time:5,start:5,end:40});
  assert.deepEqual(movePlayhead('follow',50,100,20,40),{time:50,start:20,end:50});
  assert.deepEqual(movePlayhead('follow',150,100,20,40),{time:100,start:20,end:100});
  assert.deepEqual(movePlayhead('follow',-10,100,20,40),{time:0,start:0,end:40});
  assert.deepEqual(movePlayhead('free',50,100,20,40),{time:50,start:20,end:40});
  assert.deepEqual(movePlayhead('free',150,100,20,40),{time:100,start:20,end:40});
});
test('output-only parser accepts quoted filters and refuses commands, paths, scripts and extra inputs',()=>{
  assert.deepEqual(parseCustomArgs('-vf "scale=640:-2,fps=24" -c:v libx264'),['-vf','scale=640:-2,fps=24','-c:v','libx264']);
  for(const text of ['ffmpeg -c copy','-i secret.mp4','-c copy output.mp4','-filter_script file','-vf movie=secret.mp4','-vf "scale=1280:-2;movie=file"','-y','-progress output.txt','-c:v "libx264','-c:v libx264\n-i file']) assert.throws(()=>parseCustomArgs(text),/encoding.invalidOptions/);
  for(const options of Object.values(PRESET_OPTIONS)) assert.ok(parseCustomArgs(options).length);
  assert.throws(()=>customEncodingPreset('-c copy','../file'),/invalidExtension/);
});
test('custom output mode stays separate from presets and keeps app-owned inputs/output',()=>{
  const payload={url:'https://www.youtube.com/watch?v=fixture',segments:[{start:0,end:1}],encodingPreset:'custom',customFfmpegArgs:'-c:v libx264 -crf 21 -c:a aac',customExtension:'mov'};
  const request=normalizeDownloadRequest(payload);
  assert.equal(request.encodingPreset.extension,'mov');
  const args=buildFfmpegArgs({encodingPreset:request.encodingPreset,inputPath:'input.mkv',outputPath:'output.mov',start:0,duration:1});
  assert.equal(args.at(-1),'output.mov');assert.equal(args.filter(v=>v==='-i').length,1);assert.ok(args.includes('21'));
  assert.equal(normalizeDownloadRequest({...payload,encodingPreset:'h264-mp4',customFfmpegArgs:'invalid'}).encodingPreset.id,'h264-mp4');
});
test('bundled FFmpeg produces every additional preset and a manual output from synthetic media',async()=>{
  const binary=testBinary('ffmpeg');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-encoding-test-'));
  try {
    const source=path.join(dir,'source.mkv');
    execFileSync(binary,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=128x72:rate=24','-f','lavfi','-i','sine=frequency=440','-t','0.3','-c:v','libx264','-c:a','aac',source],{timeout:30000,stdio:'pipe'});
    for(const preset of [...EXTRA_PRESETS,customEncodingPreset('-c:v libx264 -crf 22 -c:a aac','mp4')]){
      const output=path.join(dir,`${preset.id}.${preset.extension}`);
      const args=buildFfmpegArgs({encodingPreset:preset,inputPath:source,outputPath:output,start:0,duration:0.2});
      execFileSync(binary,args,{timeout:30000,stdio:'pipe'});
      assert.ok((await fs.stat(output)).size>0,preset.id);
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
