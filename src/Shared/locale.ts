export const SUPPORTED_LOCALES = ["ko", "en", "ja"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(value: unknown): SupportedLocale {
  const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(language as SupportedLocale)
    ? (language as SupportedLocale)
    : "ko";
}
