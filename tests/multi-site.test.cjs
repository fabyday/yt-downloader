require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseVideoSource, previewSource, isPreviewMediaUrl } = require('../src/Shared/VideoSource.ts');
const { CookieStore, normalizeCookieFile } = require('../src/Worker/CookieStore.ts');
const { exportBrowserCookies } = require('../src/Worker/BrowserCookies.ts');
const { normalizeDownloadRequest } = require('../src/Worker/DownloadEngine.ts');
const { selectPreview, resolvePreview } = require('../src/Worker/PreviewResolver.ts');
const { cookieSite } = require('../src/Shared/cookies.ts');
const { ytDlpSiteArgs } = require('../src/Worker/YtDlpPlugins.ts');
const row = (domain,name,value='fixture-only',expiry=0) => [domain,'TRUE','/','TRUE',expiry,name,value].join('\t');
const file = (...rows) => ['# Netscape HTTP Cookie File',...rows,''].join('\n');

test('CHZZK plugin is scoped to CHZZK and included as an unpacked build asset', () => {
  assert.deepEqual(ytDlpSiteArgs('https://youtube.com/watch?v=K7bx0zyTYFM'),[]);
  const args=ytDlpSiteArgs('https://chzzk.naver.com/video/15639975');
  assert.equal(args[0],'--no-plugin-dirs');
  assert.ok(require('node:fs').existsSync(path.join(args[2],'kawai/yt_dlp_plugins/extractor/kawai_chzzk.py')));
  assert.ok(require('../package.json').build.asarUnpack.includes('build/worker/yt-dlp-plugins/**/*'));
});

test('sources and download validation accept public extractor URLs, reject local/unsafe inputs', async () => {
  const source = parseVideoSource('https://chzzk.naver.com/video/1980?t=10');
  assert.deepEqual(source, {site:'chzzk',id:'1980',key:'chzzk:1980',url:'https://chzzk.naver.com/video/1980'});
  assert.deepEqual(previewSource(source.key),source);
  assert.equal(parseVideoSource('https://youtu.be/K7bx0zyTYFM').site,'youtube');
  for (const url of ['file:///etc/passwd','https://chzzk.naver.com.evil.test/video/1980',
    'https://user:pass@chzzk.naver.com/video/1980','https://chzzk.naver.com:444/video/1980',
    'https://127.0.0.1/video/1980','https://localhost/a','https://192.168.0.1/a','https://2130706433/a',
    'https://[::1]/a','https://machine.local/a','ftp://example.com/a','--exec=whoami','https://chzzk.naver.com/live/abcd']) {
    assert.equal(parseVideoSource(url),null,url);
    assert.throws(()=>normalizeDownloadRequest({url,locale:'en',segments:[{start:0,end:1}]}));
  }
  assert.equal(normalizeDownloadRequest({url:source.url,locale:'en',segments:[{start:1,end:2}]}).url,source.url);
  assert.deepEqual(await resolvePreview('https://127.0.0.1/',{command:'not-run'}),{ok:false,error:'preview.failed'});
  assert.throws(()=>cookieSite('../youtube'),/invalidSite/);
});

test('generic sources retain queries, round trip through preview IPC, and do not enable CHZZK plugins', () => {
  for (const url of ['https://vimeo.com/76979871', 'https://www.twitch.tv/videos/12345',
    'https://www.bilibili.com/video/BV1abc', 'https://example.com/watch?asset=123&signature=fixture',
    'http://example.com/video', 'https://chzzk.naver.com/clips/example']) {
    const source = parseVideoSource(url);
    assert.equal(source.site, 'generic');
    assert.deepEqual(previewSource(source.key), source);
    assert.equal(normalizeDownloadRequest({url, segments:[{start:0,end:3}]}).url,url);
    assert.deepEqual(ytDlpSiteArgs(url), []);
  }
  assert.equal(previewSource('web:https://127.0.0.1/a'), null);
});

test('generic previews support HTTPS MP4/HLS; incompatible streams retain metadata for download', () => {
  const key = parseVideoSource('https://vimeo.com/76979871').key;
  const media = {url:'https://video.example.com/fixture.mp4',protocol:'https',ext:'mp4',height:720,vcodec:'avc1.42',acodec:'mp4a.40.2'};
  assert.equal(selectPreview({title:'Fixture',duration:30,formats:[media]},key).url,media.url);
  assert.equal(selectPreview({formats:[{...media,protocol:'m3u8_native'}]},key).transport,'hls');
  assert.deepEqual(selectPreview({title:'Fixture',duration:30,formats:[{...media,vcodec:'hevc'}]},key),
    {ok:false,error:'preview.unavailable',title:'Fixture',duration:30});
  assert.equal(selectPreview({_type:'playlist',entries:[]},key).error,'preview.collectionUnsupported');
  assert.equal(selectPreview({is_live:true},key).error,'preview.liveUnsupported');
  assert.equal(selectPreview({has_drm:true},key).error,'preview.drmUnsupported');
  for (const url of ['file:///secret','http://video.example.com/a','https://127.0.0.1/a','https://[::1]/a','https://user:password@example.com/a']) {
    assert.equal(isPreviewMediaUrl(url,'generic'),false);
    assert.equal(selectPreview({formats:[{...media,url}]},key).ok,false);
  }
});

test('generic cookies are explicit file imports and isolated from YouTube/CHZZK', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-generic-cookies-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const generic = new CookieStore(root,'generic'), youtube = new CookieStore(root);
  await generic.import(file(row('.vimeo.com','session'),row('localhost','secret'),row('127.0.0.1','secret')));
  assert.deepEqual(await generic.getStatus(),{configured:true,count:1});
  assert.equal((await youtube.getStatus()).configured,false);
  const snapshot=await generic.createSnapshot();
  assert.match(await fs.readFile(snapshot.path,'utf8'),/vimeo\.com/);
  await snapshot.dispose();
  assert.throws(()=>require('../src/Shared/cookies.ts').browserCookieSpec({browser:'chrome',site:'generic'}),/genericFileOnly/);
});

test('CHZZK preview picks bounded MP4 or HLS and rejects DRM/live/untrusted hosts', () => {
  const f = {url:'https://b01-kr-naver-vod.pstatic.net/fixture.mp4',protocol:'https',ext:'mp4',height:720,vcodec:'avc1.42',acodec:'mp4a.40.2'};
  assert.equal(selectPreview({formats:[f]},'chzzk:1980').url,f.url);
  const hls = {...f,protocol:'m3u8_native',url:'https://livecloud.pstatic.net/fixture.m3u8'};
  assert.equal(selectPreview({formats:[hls]},'chzzk:1980').transport,'hls');
  for (const bad of [{...f,has_drm:true},{...f,url:'https://pstatic.net.evil.test/a'},
    {...f,url:'https://127.0.0.1/a'},{...f,url:'https://googlevideo.com/a'},{...f,acodec:'none'}]) {
    assert.equal(selectPreview({formats:[bad]},'chzzk:1980').ok,false);
  }
  assert.equal(selectPreview({formats:[f],is_live:true},'chzzk:1980').error,'preview.liveUnsupported');
  assert.equal(isPreviewMediaUrl('file:///a','chzzk'),false);
  assert.equal(isPreviewMediaUrl(f.url,'youtube'),false);
});

test('site cookie jars import, snapshot and clear independently with minimal Naver scope', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-site-cookies-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const youtube=new CookieStore(root),chzzk=new CookieStore(root,'chzzk');
  const mixed=file(row('.youtube.com','SID'),row('.naver.com','NID_AUT'),row('.naver.com','NID_SES'),
    row('.chzzk.naver.com','session'),row('.naver.com','unrelated'),row('.mail.naver.com','NID_AUT'),
    row('.naver.com.evil.test','NID_AUT'),row('.chzzk.naver.com','expired','secret',1));
  await youtube.import(mixed); await chzzk.import(mixed);
  assert.deepEqual(await youtube.getStatus(),{configured:true,count:1});
  assert.deepEqual(await chzzk.getStatus(),{configured:true,count:3,loginCookiesPresent:true});
  const snapshot=await chzzk.createSnapshot();
  const contents=await fs.readFile(snapshot.path,'utf8');
  assert.doesNotMatch(contents,/youtube|unrelated|mail|evil|expired/);
  await chzzk.clear();
  assert.equal((await youtube.getStatus()).configured,true);
  assert.equal((await chzzk.getStatus()).configured,false);
  assert.equal(await fs.readFile(snapshot.path,'utf8'),contents);
  await snapshot.dispose();
  await assert.rejects(chzzk.import(file(row('.youtube.com','SID'))),/cookies.empty/);
  assert.equal((await chzzk.getStatus()).configured,false);
  await chzzk.import(file(row('.naver.com','NID_AUT')));
  assert.equal((await chzzk.getStatus()).loginCookiesPresent,false);
  assert.throws(()=>normalizeCookieFile(mixed,Date.now(),1024*1024,'invalid'),/invalidSite/);
});

test('browser extraction keeps only explicitly selected site and deletes temporary full jar', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-chzzk-export-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const contents=await exportBrowserCookies({browser:{browser:'chrome',site:'chzzk'},directory:root,command:'fixture',
    run:async(_command,args)=>{
      await fs.writeFile(args[args.indexOf('--cookies')+1],file(row('.youtube.com','SID'),row('.naver.com','NID_AUT'),row('.naver.com','NID_SES')));
      return {code:2,stderr:'You must provide at least one URL'};
    }});
  assert.doesNotMatch(contents,/youtube/); assert.match(contents,/NID_AUT/);
  assert.deepEqual(await fs.readdir(root),[]);
});
