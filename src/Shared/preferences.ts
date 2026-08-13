import { normalizeLocale, type SupportedLocale } from "./locale";
import type { AppPreferences } from "./types";

export const DOWNLOAD_QUALITIES = [
  "best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360",
] as const;

export const SPEED_LIMITS = ["", "1M", "2M", "5M", "10M", "20M", "50M"] as const;

export const ENCODING_PRESETS = [
  "youtube-copy",
  "h264-mp4",
  "premiere-prores",
  "davinci-dnxhr",
] as const;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  automaticUpdates: true,
  defaultDownloadQuality: "best",
  defaultEncodingPreset: "youtube-copy",
  defaultOutputDir: "",
  defaultSpeedLimit: "",
  frameRate: 30,
  locale: "ko",
  seekLargeSeconds: 10,
  seekSmallSeconds: 1,
};

export function normalizeAppPreferences(
  value: Partial<AppPreferences> | null | undefined,
  defaults: AppPreferences = DEFAULT_APP_PREFERENCES,
): AppPreferences {
  return {
    automaticUpdates: normalizeBoolean(
      value?.automaticUpdates,
      defaults.automaticUpdates,
    ),
    defaultDownloadQuality: normalizeOption(
      value?.defaultDownloadQuality,
      DOWNLOAD_QUALITIES,
      defaults.defaultDownloadQuality,
    ),
    defaultEncodingPreset: normalizeOption(
      value?.defaultEncodingPreset,
      ENCODING_PRESETS,
      defaults.defaultEncodingPreset,
    ),
    defaultOutputDir:
      typeof value?.defaultOutputDir === "string"
        ? value.defaultOutputDir.trim()
        : defaults.defaultOutputDir,
    defaultSpeedLimit: normalizeOption(
      value?.defaultSpeedLimit,
      SPEED_LIMITS,
      defaults.defaultSpeedLimit,
    ),
    frameRate: normalizeNumber(value?.frameRate, defaults.frameRate, 1, 240),
    locale: normalizeLocale(value?.locale ?? defaults.locale),
    seekLargeSeconds: normalizeNumber(
      value?.seekLargeSeconds,
      defaults.seekLargeSeconds,
      0.01,
      3600,
    ),
    seekSmallSeconds: normalizeNumber(
      value?.seekSmallSeconds,
      defaults.seekSmallSeconds,
      0.01,
      3600,
    ),
  };
}

export function createDefaultAppPreferences(
  locale: SupportedLocale,
  outputDir: string,
): AppPreferences {
  return normalizeAppPreferences(
    { locale, defaultOutputDir: outputDir },
    DEFAULT_APP_PREFERENCES,
  );
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeOption(
  value: unknown,
  options: readonly string[],
  fallback: string,
): string {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}
