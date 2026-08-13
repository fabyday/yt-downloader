import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import { normalizeLocale, type SupportedLocale } from "./locale";

type TranslationCatalog = Record<string, string>;
type TranslationParams = Record<string, string | number>;

const catalogs: Record<SupportedLocale, TranslationCatalog> = {
  en,
  ja,
  ko,
};

export function translate(
  localeValue: unknown,
  key: string,
  params: TranslationParams = {},
): string {
  const catalog = catalogs[normalizeLocale(localeValue)] || catalogs.ko;
  const template = catalog[key] ?? key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}
