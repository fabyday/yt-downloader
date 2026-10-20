import type { CookieImportData } from '../../Shared/cookies';
import type { DownloadQueueItem } from "../../Shared/types";
import { parseVideoSource } from "../../Shared/VideoSource";
import type {
  CompanionCallbackDescriptor,
  DownloaderDeepLinkRequest,
} from "../ExternalProtocol";

type CompanionEventName =
  | "request.received"
  | "source.accepted"
  | "source.rejected"
  | "download.queued"
  | "download.progress"
  | "download.completed"
  | "download.failed";

interface TrackedRequest {
  callback: CompanionCallbackDescriptor;
  lastQueueSignature?: string;
  sendChain: Promise<void>;
  sourceUrl: string;
  expires: number;
  reportProgress: boolean;
  cookies?: Promise<CookieImportData | null>;
}

/** Reports external-request validation and download lifecycle events to Kawaikara. */
export class CompanionManager {
  private readonly requests = new Map<string, TrackedRequest>();

  /**
   * Accepts a source-editor handoff without starting a download.
   * @param request - Validated deep-link source and optional authenticated callback.
   * @param reportProgress - Explicit opt-in for integrations that also need queue events.
   */
  acceptDeepLink(request: DownloaderDeepLinkRequest, reportProgress = false): void {
    if (!request.companion) return;
    for (const [id, value] of this.requests) if (value.expires <= Date.now()) this.requests.delete(id);
    if (this.requests.size >= 128) this.requests.delete(this.requests.keys().next().value!);
    const tracked: TrackedRequest = {
      callback: request.companion,
      sourceUrl: request.sourceUrl,
      expires: Date.now() + 60 * 60 * 1000,
      reportProgress,
      sendChain: Promise.resolve(),
    };
    this.requests.set(request.companion.requestId, tracked);
    this.enqueue(tracked, "request.received");
    if (parseVideoSource(request.sourceUrl)) {
      this.enqueue(tracked, "source.accepted");
    } else {
      this.enqueue(tracked, "source.rejected", {
        code: "unsupported-source",
        message: "The external source is not supported by kawai-downloader.",
      });
      this.finishWhenSent(request.companion.requestId, tracked);
    }
  }

  /**
   * Requests optional credentials once per handoff, wholly within Main.
   * @param requestId - Request selected from the sender's native tab, never arbitrary Renderer input.
   * @param sourceUrl - Must match the original source before contacting the host.
   * @returns Approved records or null on denial, timeout, cancellation or an unavailable app.
   */
  async requestCookies(requestId: string, sourceUrl: string): Promise<CookieImportData | null> {
    const tracked = this.requests.get(requestId);
    if (!tracked || tracked.expires <= Date.now() || parseVideoSource(tracked.sourceUrl)?.key !== parseVideoSource(sourceUrl)?.key) return null;
    tracked.cookies ??= (async () => {
      try {
        const response = await fetch(tracked.callback.callbackUrl + '/host', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(125_000),
          headers: { authorization: `Bearer ${tracked.callback.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'cookies.read', permission: 'session' }),
        });
        if (!response.ok) return null;
        if (!response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024 * 1024) { await reader.cancel(); return null; }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const cookies = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return Array.isArray(cookies) ? { format: 'records' as const, cookies } : null;
      } catch { return null; }
    })();
    return tracked.cookies;
  }

  reportQueue(items: readonly DownloadQueueItem[]): void {
    for (const item of items) {
      const requestId = item.companionRequestId;
      if (!requestId) continue;
      const tracked = this.requests.get(requestId);
      if (!tracked?.reportProgress) continue;
      const progressBucket = Math.floor(Math.max(0, Math.min(1, item.progress)) * 20);
      const signature = [
        item.status,
        String(progressBucket),
        item.error ?? "",
      ].join("|");
      if (signature === tracked.lastQueueSignature) continue;
      tracked.lastQueueSignature = signature;

      const common = {
        message: item.message,
        progress: Math.max(0, Math.min(1, item.progress)),
        queueItemId: item.id,
        stage: item.status,
      };
      if (item.status === "done") {
        this.enqueue(tracked, "download.completed", common);
        this.finishWhenSent(requestId, tracked);
      } else if (item.status === "error") {
        this.enqueue(tracked, "download.failed", {
          ...common,
          code: "download-failed",
          message: item.error || item.message,
        });
        this.finishWhenSent(requestId, tracked);
      } else if (item.status === "queued") {
        this.enqueue(tracked, "download.queued", common);
      } else {
        this.enqueue(tracked, "download.progress", common);
      }
    }
  }

  private enqueue(
    tracked: TrackedRequest,
    event: CompanionEventName,
    details: Record<string, unknown> = {},
  ): void {
    tracked.sendChain = tracked.sendChain
      .then(() => sendCompanionEvent(tracked.callback, event, details))
      .catch((error) => {
        console.warn("Kawaikara companion callback failed", {
          event,
          message: error instanceof Error ? error.message : String(error),
          requestId: tracked.callback.requestId,
        });
      });
  }

  private finishWhenSent(requestId: string, tracked: TrackedRequest): void {
    void tracked.sendChain.finally(() => {
      if (this.requests.get(requestId) === tracked) this.requests.delete(requestId);
    });
  }
}

async function sendCompanionEvent(
  callback: CompanionCallbackDescriptor,
  event: CompanionEventName,
  details: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(callback.callbackUrl, {
    body: JSON.stringify({
      event,
      requestId: callback.requestId,
      timestamp: new Date().toISOString(),
      ...details,
    }),
    headers: {
      authorization: `Bearer ${callback.token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`Kawaikara callback returned HTTP ${response.status}`);
  }
}
