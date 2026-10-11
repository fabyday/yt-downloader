import { Surface, Stack, Text } from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import type { YtDlpUpdateStatus } from "../../Shared/types";
import { useI18n } from "../I18nProvider";

export function YtDlpUpdateInfo() {
  const { t } = useI18n();
  const [state, setState] = useState<YtDlpUpdateStatus | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await window.ytClipper.getYtDlpUpdateStatus();
        if (!active) return;
        setState(value);
        if (value.status === "checking" || value.status === "downloading") timer = setTimeout(poll, 2000);
      } catch {
        if (active) setState({ status: "error", version: null });
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return <Surface padding="md" radius="md" className="preference-section-card">
    <Stack gap="sm">
      <Text weight="semibold">{t("ytDlpUpdate.title")}</Text>
      <Text size="sm" tone="muted">{t("ytDlpUpdate.description")}</Text>
      <Text size="sm" aria-live="polite">{t(`ytDlpUpdate.${state?.status ?? "checking"}`)}</Text>
      {state?.version && <Text size="sm">{t("preference.version", { version: state.version })}</Text>}
    </Stack>
  </Surface>;
}
