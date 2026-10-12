import { useEffect, useRef } from "react";
import { Flex, Stack, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";

export function BrowserClosePrompt({ browser, platform, busy, message, onCancel, onRetry }: {
  browser: string; platform: string; busy: boolean; message: string;
  onCancel: () => void; onRetry: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="browser-close-prompt" role="alertdialog" aria-modal="true"
    aria-labelledby="browserCloseTitle" aria-describedby="browserCloseDescription"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
    <Stack gap="md">
      <Text id="browserCloseTitle" size="lg" weight="semibold">{t("cookies.closeBrowserTitle", { browser })}</Text>
      <Text id="browserCloseDescription" size="sm">{t("cookies.closeBrowserDescription", { browser })}</Text>
      <Text size="sm" tone="muted">{t(platform === "darwin" ? "cookies.closeBrowserMac" : "cookies.closeBrowserOther", { browser })}</Text>
      <Text size="sm" role="status" aria-live="polite" className="browser-close-status">{message}</Text>
      <Flex justify="end" gap="sm" wrap>
        <button type="button" className="cookie-button cookie-button-secondary" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" className="cookie-button cookie-button-primary" disabled={busy} onClick={onRetry}>{t("cookies.recheckAndExtract")}</button>
      </Flex>
    </Stack>
  </dialog>;
}
