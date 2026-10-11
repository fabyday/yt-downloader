import { Button, Flex, Input, Select, Surface, Stack, Text } from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import type { CookieStatus } from "../../Shared/types";
import { COOKIE_BROWSERS, type CookieBrowser } from "../../Shared/cookies";
import { useI18n } from "../I18nProvider";

export function PreferenceCookies() {
  const { t } = useI18n();
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<CookieBrowser>("chrome");
  const [profile, setProfile] = useState("");
  const [platform, setPlatform] = useState("");
  useEffect(() => {
    let active = true;
    void window.ytClipper.getAppInfo().then((info) => { if (active) setPlatform(info.platform); }).catch(() => {});
    void window.ytClipper.getCookieStatus().then((value) => {
      if (active) setStatus(value);
    }).catch(() => { if (active) setError("cookies.readFailed"); });
    return () => { active = false; };
  }, []);

  const change = async (action: "browser" | "file" | "clear") => {
    setBusy(true);
    setError(null);
    try {
      const result = await (action === "clear" ? window.ytClipper.clearCookies()
        : action === "file" ? window.ytClipper.importCookies()
        : window.ytClipper.importBrowserCookies({ browser, profile }));
      if (result) setStatus(result);
    } catch (error) {
      const code = ["cookies.invalidBrowser", "cookies.invalidProfile", "cookies.browserTimeout",
        "cookies.browserBusy", "cookies.browserMissing", "cookies.browserLocked", "cookies.decryptFailed",
        "cookies.browserFailed", "cookies.invalid", "cookies.empty", "cookies.readFailed", "cookies.saveFailed"]
        .find((key) => String(error).includes(key));
      setError(code ?? "cookies.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  return <Surface padding="md" radius="md" className="preference-section-card">
    <Stack gap="sm">
      <Text weight="semibold">{t("cookies.title")}</Text>
      <Text size="sm" tone="muted">{t("cookies.description")}</Text>
      <Select label={t("cookies.browser")} value={browser} disabled={busy}
        options={COOKIE_BROWSERS.filter((value) => value !== "safari" || platform === "darwin")
          .map((value) => ({ value, label: value === "firefox" ? "Firefox" : value[0].toUpperCase() + value.slice(1) }))}
        onValueChange={(value) => { setBrowser(value as CookieBrowser); setProfile(""); }} />
      {browser !== "safari" && <Input label={t("cookies.profile")} value={profile} disabled={busy}
        placeholder={t("cookies.profilePlaceholder")}
        onChange={(event) => setProfile(event.target.value)} />}
      <Text size="sm" aria-live="polite">{status
        ? t(status.configured ? "cookies.configured" : "cookies.none", { count: status.count })
        : t("cookies.loading")}</Text>
      <Flex gap="sm" wrap>
        <Button disabled={busy} isLoading={busy} onClick={() => void change("browser")}>{t(busy ? "cookies.importing" : "cookies.import")}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void change("file")}>{t("cookies.importFile")}</Button>
        <Button variant="secondary" disabled={busy || !status?.configured} onClick={() => void change("clear")}>{t("cookies.clear")}</Button>
        <Button variant="ghost" onClick={() => void window.ytClipper.openExternalUrl("https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies")}>
          {t("cookies.help")}
        </Button>
      </Flex>
      <Text size="xs" tone="muted">{t("cookies.appliesImmediately")}</Text>
      {error && <Text size="sm" role="alert">{t(error)}</Text>}
    </Stack>
  </Surface>;
}
