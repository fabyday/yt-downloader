import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { flushSync } from "react-dom";
import type { SupportedLocale } from "../Shared/locale";
import {
  getLocale,
  LOCALE_CHANGE_EVENT,
  setLocale,
  translate,
  type TranslationParams,
} from "./i18n";

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "ko",
  setLocale,
  t: translate,
});

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, updateLocale] = useState(getLocale());

  useEffect(() => {
    const handleLocaleChange = () => {
      flushSync(() => updateLocale(getLocale()));
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    return () =>
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: translate }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
