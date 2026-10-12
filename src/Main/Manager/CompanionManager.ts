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
}

/** Reports external-request validation and download lifecycle events to Kawaikara. */
export class CompanionManager {
  private readonly requests = new Map<string, TrackedRequest>();

  acceptDeepLink(request: DownloaderDeepLinkRequest): void {
    if (!request.companion) return;
    const tracked: TrackedRequest = {
      callback: request.companion,
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

  reportQueue(items: readonly DownloadQueueItem[]): void {
    for (const item of items) {
      const requestId = item.companionRequestId;
      if (!requestId) continue;
      const tracked = this.requests.get(requestId);
      if (!tracked) continue;
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
