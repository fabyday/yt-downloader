import { normalizeLocale, type SupportedLocale } from "../Shared/locale";

export const LOCALE_CHANGE_EVENT = "yt-downloader:locale-change";

export type TranslationParams = Record<string, string | number>;
type TranslationCatalog = Record<string, string>;

const LOCALE_STORAGE_KEY = "yt-downloader.locale";
const catalogCache = new Map<SupportedLocale, TranslationCatalog>();

let currentLocale: SupportedLocale = "ko";
let currentCatalog: TranslationCatalog = {};
let fallbackCatalog: TranslationCatalog = {};
let preferencesSubscribed = false;

async function getPreferredLocale(): Promise<SupportedLocale> {
  try {
    const preferences = await window.ytClipper?.getPreferences?.();
    if (preferences?.locale) {
      return normalizeLocale(preferences.locale);
    }
  } catch {
    // Fall back to the renderer's last known value when Main is unavailable.
  }

  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved) {
      return normalizeLocale(saved);
    }
  } catch {
    // Storage can be unavailable in hardened renderer environments.
  }

  return normalizeLocale(navigator.languages?.[0] || navigator.language);
}

async function loadCatalog(locale: SupportedLocale): Promise<TranslationCatalog> {
  const cached = catalogCache.get(locale);
  if (cached) {
    return cached;
  }

  const response = await fetch(`./locales/${locale}.json`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load locale catalog: ${locale}`);
  }

  const catalog = (await response.json()) as TranslationCatalog;
  catalogCache.set(locale, catalog);
  return catalog;
}

function applyDocumentLocale(): void {
  document.documentElement.lang = currentLocale;
  const view = new URLSearchParams(window.location.search).get("view");
  document.title =
    view === "queue"
      ? translate("queue.windowTitle")
      : translate("app.documentTitle");
}

export async function initializeI18n(): Promise<void> {
  const preferredLocale = await getPreferredLocale();
  fallbackCatalog = await loadCatalog("ko");

  try {
    currentCatalog =
      preferredLocale === "ko"
        ? fallbackCatalog
        : await loadCatalog(preferredLocale);
    currentLocale = preferredLocale;
  } catch {
    currentLocale = "ko";
    currentCatalog = fallbackCatalog;
  }

  applyDocumentLocale();
  if (!preferencesSubscribed && window.ytClipper?.onPreferencesChanged) {
    preferencesSubscribed = true;
    window.ytClipper.onPreferencesChanged((preferences) => {
      void applyLocale(preferences.locale);
    });
  }
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  await applyLocale(locale);
  try {
    await window.ytClipper?.updatePreferences?.({
      locale: normalizeLocale(locale),
    });
  } catch {
    // The locale remains active for this renderer session.
  }
}

async function applyLocale(locale: SupportedLocale): Promise<void> {
  const nextLocale = normalizeLocale(locale);
  const nextCatalog = await loadCatalog(nextLocale);
  currentLocale = nextLocale;
  currentCatalog = nextCatalog;

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  } catch {
    // The active locale still applies for this session when storage is blocked.
  }

  applyDocumentLocale();
  window.dispatchEvent(
    new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale: nextLocale } }),
  );
}

export function translate(
  key: string,
  params: TranslationParams = {},
): string {
  const template = currentCatalog[key] ?? fallbackCatalog[key] ?? key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}
