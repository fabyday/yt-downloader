const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createDownloaderDeepLink,
  getSourceUrlFromDeepLink,
  isSupportedYouTubeUrl,
} = require("../src/Main/ExternalProtocol.ts");

test("the public deep-link surface accepts declared YouTube video routes", () => {
  for (const url of [
    "https://youtube.com/watch?v=fixture",
    "https://youtube.com/embed/fixture",
    "https://www.youtube.com/shorts/fixture",
    "https://m.youtube.com/live/fixture",
    "https://music.youtube.com/watch?v=fixture",
    "https://youtu.be/fixture",
  ]) {
    assert.equal(isSupportedYouTubeUrl(url), true, url);
    assert.equal(getSourceUrlFromDeepLink(createDownloaderDeepLink(url)), url);
  }
});

test("the external app owns source support while the deep link transports failures", () => {
  for (const url of [
    "https://laftel.net/item/12345",
    "https://netflix.com/watch/12345",
    "https://youtube.com/",
    "https://youtube.com/watch",
    "https://youtube.com.evil.example/watch?v=fixture",
    "http://youtube.com/watch?v=fixture",
    "https://user:password@youtube.com/watch?v=fixture",
    "https://youtube.com:444/watch?v=fixture",
  ]) {
    assert.equal(isSupportedYouTubeUrl(url), false, url);
    assert.equal(
      getSourceUrlFromDeepLink(createDownloaderDeepLink(url)),
      url,
      "unsupported sources reach YT Downloader so its UI can report the failure",
    );
  }
});

test("malformed companion envelopes are ignored before opening a tab", () => {
  assert.equal(getSourceUrlFromDeepLink("https://youtube.com/watch?v=fixture"), null);
  assert.equal(getSourceUrlFromDeepLink("yt-downloader://wrong?url=value"), null);
  assert.equal(getSourceUrlFromDeepLink("yt-downloader://open"), null);
});
