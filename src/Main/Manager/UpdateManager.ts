import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import type { AppUpdateInfo } from "../../Shared/types";
import { BaseManager } from "./BaseManager";
import { UpdateReturnType } from "./ReturnTypes";

export class UpdateManager extends BaseManager<UpdateReturnType> {
  private static readonly LATEST_RELEASE_URL =
    "https://api.github.com/repos/fabyday/yt-downloader/releases/latest";

  async initialize(): Promise<ReturnCode<UpdateReturnType>> {
    return successReturnCode(
      UpdateReturnType.Initialized,
      "Update manager initialized",
    );
  }

  async finalize(): Promise<ReturnCode<UpdateReturnType>> {
    return successReturnCode(
      UpdateReturnType.Finalized,
      "Update manager finalized",
    );
  }

  async checkForUpdates(
    currentVersion: string,
  ): Promise<ReturnCode<UpdateReturnType, AppUpdateInfo>> {
    try {
      const response = await fetch(UpdateManager.LATEST_RELEASE_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "YT-Section-Downloader",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
      }
      const release = (await response.json()) as {
        html_url?: unknown;
        tag_name?: unknown;
      };
      const latestVersion = normalizeVersion(release.tag_name);
      if (!latestVersion) throw new Error("The latest release has no valid version");
      const releaseUrl =
        typeof release.html_url === "string" ? release.html_url : null;
      const available = compareVersions(latestVersion, currentVersion) > 0;
      const data: AppUpdateInfo = {
        currentVersion,
        latestVersion,
        message: available ? "A newer release is available" : "The app is current",
        releaseUrl,
        status: available ? "available" : "current",
      };
      return successReturnCode(
        available ? UpdateReturnType.UpdateAvailable : UpdateReturnType.NoUpdate,
        data.message,
        data,
      );
    } catch (error) {
      return failureReturnCode(
        UpdateReturnType.CheckFailed,
        "Could not check for updates",
        getErrorMessage(error),
      );
    }
  }

  async downloadUpdate(): Promise<ReturnCode<UpdateReturnType>> {
    // Implement the logic to download updates here
    return successReturnCode(
      UpdateReturnType.UpdateDownloaded,
      "Update downloaded successfully",
    );
  }

  async applyUpdate(): Promise<ReturnCode<UpdateReturnType>> {
    // Implement the logic to apply updates here
    return successReturnCode(
      UpdateReturnType.UpdateApplied,
      "Update applied successfully",
    );
  }
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$/i);
  return match?.[1] ?? null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
