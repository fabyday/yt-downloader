require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectPreview, previewFailure, resolvePreview } = require('../src/Worker/PreviewResolver.ts');
const format = {url:'https://media.googlevideo.com/videoplayback?fixture', protocol:'https', ext:'mp4', vcodec:'avc1.42', acodec:'mp4a.40.2', height:360};
test('selects a muxed, bounded quality preview; rejects unsafe URLs and split streams', () => {
  const result = selectPreview({title:'fixture', formats:[format, {...format, height:720, url:'https://media.googlevideo.com/720'}, {...format, height:1080}, {...format, height:720, acodec:'none'}]}, 'K7bx0zyTYFM');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://media.googlevideo.com/720');
  for (const url of ['http://media.googlevideo.com/a', 'https://googlevideo.com.evil.test/a', 'file:///a', 'https://user:pass@media.googlevideo.com/a',
    'https://c.youtube.com.evil.test/a', 'https://notc.youtube.com/a', 'https://www.youtube.com/a',
    'https://media.c.youtube.com:444/a', 'https://user:pass@media.c.youtube.com/a']) {
    assert.deepEqual(selectPreview({formats:[{...format,url}]}, 'fixture'), {ok:false,error:'preview.unavailable'});
  }
});
test('private-video cookie-scoped CDN is accepted for muxed and split streams', () => {
  const privateVideo = {...format, url:'https://rr2---fixture.c.youtube.com/videoplayback?fixture'};
  assert.equal(selectPreview({formats:[privateVideo]}, 'K7bx0zyTYFM').url, privateVideo.url);
  const audio = {...privateVideo, vcodec:'none', ext:'m4a', url:'https://rr2---fixture.c.youtube.com/audio?fixture'};
  const result = selectPreview({formats:[{...privateVideo,acodec:'none'},audio]}, 'K7bx0zyTYFM');
  assert.equal(result.ok, true);
  assert.equal(result.audioUrl, audio.url);
});
test('errors distinguish expired cookies from access denial without leaking stderr', async () => {
  assert.deepEqual(previewFailure('The provided YouTube account cookies are no longer valid. They have likely been rotated.'), {ok:false,error:'preview.expired'});
  assert.deepEqual(previewFailure('Private video secret-cookie'), {ok:false,error:'preview.denied'});
  assert.deepEqual(previewFailure('The web client only works when logged-in.'), {ok:false,error:'preview.denied'});
  assert.deepEqual(previewFailure('This video is DRM protected'), {ok:false,error:'preview.drmUnsupported'});
  assert.deepEqual(await resolvePreview('--injection', {command:'not-run',nodeRuntimePath:''}), {ok:false,error:'preview.failed'});
});
test('pairs split H.264 and AAC, never silently serves video without sound', () => {
  const video = {...format, acodec:'none'};
  const audio = {...format, vcodec:'none', ext:'m4a', url:'https://media.googlevideo.com/audio'};
  assert.equal(selectPreview({formats:[video]}, 'fixture').ok, false);
  assert.equal(selectPreview({formats:[video,audio]}, 'fixture').audioUrl, audio.url);
});
