const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const {
  createDownloaderDeepLink,
  getSourceUrlFromDeepLink,
  isSupportedYouTubeUrl,
  parseDownloaderDeepLink,
} = require("../src/Main/ExternalProtocol.ts");
const { CompanionManager } = require("../src/Main/Manager/CompanionManager.ts");

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

test("a valid Kawaikara callback envelope is preserved with the source request", () => {
  const deepLink = new URL(createDownloaderDeepLink(
    "https://youtube.com/watch?v=fixture",
  ));
  deepLink.searchParams.set("requestId", "12345678-abcd");
  deepLink.searchParams.set("callback", "http://127.0.0.1:45123/v1/events/12345678-abcd");
  deepLink.searchParams.set("token", "x".repeat(32));
  assert.deepEqual(parseDownloaderDeepLink(deepLink.toString()), {
    sourceUrl: "https://youtube.com/watch?v=fixture",
    companion: {
      requestId: "12345678-abcd",
      callbackUrl: "http://127.0.0.1:45123/v1/events/12345678-abcd",
      token: "x".repeat(32),
    },
  });
});

test("non-loopback callback targets are ignored without dropping the source", () => {
  const deepLink = new URL(createDownloaderDeepLink(
    "https://youtube.com/watch?v=fixture",
  ));
  deepLink.searchParams.set("requestId", "12345678-abcd");
  deepLink.searchParams.set("callback", "https://example.com/events");
  deepLink.searchParams.set("token", "x".repeat(32));
  assert.deepEqual(parseDownloaderDeepLink(deepLink.toString()), {
    sourceUrl: "https://youtube.com/watch?v=fixture",
  });
});

test("companion callbacks report acceptance, deduplicated progress, and completion", async () => {
  const events = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${"x".repeat(32)}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    events.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(204);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const requestId = "request-12345678";
  const manager = new CompanionManager();
  manager.acceptDeepLink({
    sourceUrl: "https://youtube.com/watch?v=fixture",
    companion: {
      requestId,
      callbackUrl: `http://127.0.0.1:${address.port}/events`,
      token: "x".repeat(32),
    },
  });
  const item = {
    id: "queue-1",
    companionRequestId: requestId,
    status: "queued",
    progress: 0,
    message: "Waiting",
    error: null,
  };
  manager.reportQueue([item]);
  manager.reportQueue([{ ...item, status: "running", progress: 0.51, message: "51%" }]);
  manager.reportQueue([{ ...item, status: "running", progress: 0.52, message: "52%" }]);
  manager.reportQueue([{ ...item, status: "done", progress: 1, message: "Done" }]);

  const deadline = Date.now() + 3_000;
  while (events.length < 5 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(events.map(event => event.event), [
    "request.received",
    "source.accepted",
    "download.queued",
    "download.progress",
    "download.completed",
  ]);
  assert.equal(events[3].progress, 0.51);
  await new Promise(resolve => server.close(resolve));
});
