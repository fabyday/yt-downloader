import { Box, Select, type SelectOption } from "@kawaikara/kawai-ui";
import type { SupportedLocale } from "../../Shared/locale";
import { useI18n } from "../I18nProvider";

interface LocaleSelectProps {
  id?: string;
}

export function LocaleSelect({ id = "localeSelect" }: LocaleSelectProps) {
  const { locale, setLocale, t } = useI18n();
  const options: readonly SelectOption[] = [
    { value: "ko", label: t("locale.ko") },
    { value: "en", label: t("locale.en") },
    { value: "ja", label: t("locale.ja") },
  ];

  return (
    <Box className="locale-select">
      <Select
        id={id}
        label={t("locale.label")}
        options={options}
        value={locale}
        onValueChange={(value) => void setLocale(value as SupportedLocale)}
      />
    </Box>
  );
}
