import { Flex, Input, Surface, Stack, Text } from "@kawaikara/kawai-ui";
import type { ButtonHTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import type { CookieStatus } from "../../Shared/types";
import { COOKIE_BROWSERS, type CookieBrowser, type BrowserProfileList, type CookieSite } from "../../Shared/cookies";
import { useI18n } from "../I18nProvider";
import { PopupSelect as Select } from "./PopupSelect";
import { BrowserClosePrompt } from "./BrowserClosePrompt";

// No Motion transforms or opacity transitions when opening a native permission dialog.
function Button({ variant = "primary", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type="button" className={`cookie-button cookie-button-${variant}`} {...props} />;
}

export function PreferenceCookies() {
  const { t } = useI18n();
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [site, setSite] = useState<CookieSite>("youtube");
  const selectedStatus = status?.sites?.[site] ?? (site === "youtube" ? status : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<CookieBrowser>("chrome");
  const [profile, setProfile] = useState("");
  const [manualProfile, setManualProfile] = useState(false);
  const [profiles, setProfiles] = useState<BrowserProfileList>({ supported: true, profiles: [] });
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileRevision, setProfileRevision] = useState(0);
  const [platform, setPlatform] = useState("");
  const [development, setDevelopment] = useState(false);
  const [runtimeAppPath, setRuntimeAppPath] = useState<string | null>(null);
  const [browserRunning, setBrowserRunning] = useState<boolean | null>(null);
  const [checkingError, setCheckingError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [closeBrowserAction, setCloseBrowserAction] = useState<"browser" | "access" | null>(null);
  const operationInFlight = useRef(false);
  useEffect(() => window.ytClipper.onCookiesChanged?.(setStatus), []);
  useEffect(() => {
    let active = true;
    setProfilesLoading(true);
    void window.ytClipper.getBrowserProfiles({ browser }).then(result => {
      if (active) setProfiles(result);
    }).catch(() => {
      if (active) setProfiles({ supported: browser !== "safari" && browser !== "opera", profiles: [], error: "cookies.profilesFailed" });
    }).finally(() => { if (active) setProfilesLoading(false); });
    return () => { active = false; };
  }, [browser, profileRevision]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setBrowserRunning(null);
    const check = async () => {
      try {
        const result = await window.ytClipper.getBrowserCookieStatus({ browser });
        if (active) { setBrowserRunning(result.running); setCheckingError(false); }
      } catch { if (active) { setBrowserRunning(null); setCheckingError(true); } }
      if (active) timer = setTimeout(() => void check(), 2000);
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [browser]);
  useEffect(() => {
    let active = true;
    void window.ytClipper.getAppInfo().then((info) => {
      if (active) {
        setPlatform(info.platform);
        setDevelopment(info.isPackaged === false);
        setRuntimeAppPath(info.runtimeAppPath ?? null);
      }
    }).catch(() => {});
    void window.ytClipper.getCookieStatus().then((value) => {
      if (active) { setStatus(value); setError(value.error ?? null); }
    }).catch(() => { if (active) setError("cookies.readFailed"); });
    return () => { active = false; };
  }, []);

  const change = async (action: "browser" | "file" | "clear" | "access") => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "browser" || action === "access") {
        const current = await window.ytClipper.getBrowserCookieStatus({ browser });
        setBrowserRunning(current.running);
        setCheckingError(false);
        if (current.running) { setCloseBrowserAction(action); return; }
        setCloseBrowserAction(null);
      }
      if (action === "access") {
        await window.ytClipper.requestCookieAccess({ browser, profile, site });
        setStatus(await window.ytClipper.importBrowserCookies({ browser, profile, site }));
        setNotice("cookies.accessGranted");
        return;
      }
      const result = await (action === "clear" ? window.ytClipper.clearCookies(site)
        : action === "file" ? window.ytClipper.importCookies(site)
        : window.ytClipper.importBrowserCookies({ browser, profile, site }));
      if (result) { setStatus(result); setNotice(action === "clear" ? "cookies.cleared" : "cookies.importComplete"); }
    } catch (error) {
      const code = ["cookies.invalidBrowser", "cookies.invalidProfile", "cookies.browserTimeout",
        "cookies.keychainAccessFailed", "cookies.permissionDenied",
        "cookies.keychainMissing", "cookies.noKeychainRequest",
        "cookies.browserRunning", "cookies.processCheckFailed",
        "cookies.browserBusy", "cookies.browserMissing", "cookies.browserLocked", "cookies.decryptFailed",
        "cookies.browserFailed", "cookies.invalid", "cookies.empty", "cookies.readFailed", "cookies.saveFailed"]
        .find((key) => String(error).includes(key));
      // Reopening the browser between our check and the Worker check should
      // present the same actionable prompt, not only an inline error.
      if (code === "cookies.browserRunning" && (action === "browser" || action === "access")) {
        setBrowserRunning(true); setCloseBrowserAction(action);
      } else {
        if (code === "cookies.processCheckFailed") { setCheckingError(true); setBrowserRunning(null); }
        setError(code ?? "cookies.saveFailed");
      }
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const openPermissions = async (target: "keychain" | "files") => {
    try { await window.ytClipper.openCookiePermissionSettings(target); }
    catch { setError("cookies.settingsUnavailable"); }
  };

  return <Surface padding="md" radius="md" className="preference-section-card preference-cookies">
    <Stack gap="sm">
      <Text weight="semibold">{t("cookies.title")}</Text>
      <Select id="cookieSiteSelect" label={t("cookies.site")} value={site} disabled={busy || closeBrowserAction !== null}
        options={[{ value: "youtube", label: "YouTube" }, { value: "chzzk", label: t("source.chzzk") }, { value: "generic", label: t("source.generic") }]}
        onValueChange={value => { setSite(value as CookieSite); setError(null); setNotice(null); }} />
      <Text size="sm" tone="muted">{t(site === "generic" ? "cookies.genericGuide" : site === "chzzk" ? "cookies.chzzkGuide" : "cookies.description")}</Text>
      {site !== "generic" && <>
      <Text size="sm" tone="muted">{t("cookies.extractGuide")}</Text>
      <Select label={t("cookies.browser")} value={browser} disabled={busy}
        options={COOKIE_BROWSERS.filter((value) => value !== "safari" || platform === "darwin")
          .map((value) => ({ value, label: value === "firefox" ? "Firefox" : value[0].toUpperCase() + value.slice(1) }))}
        onValueChange={(value) => { setBrowser(value as CookieBrowser); setProfile(""); setManualProfile(false); }} />
      {profiles.supported && <Stack gap="xs">
        <Flex gap="sm" align="end" className="cookie-profile-row">
          <Select id="cookieProfileSelect" label={t("cookies.profile")} value={manualProfile ? "__manual__" : profile}
            disabled={busy || profilesLoading} options={[
              { value: "", label: t("cookies.profileAutomatic") }, ...profiles.profiles,
              { value: "__manual__", label: t("cookies.profileManual") },
            ]} onValueChange={value => { setManualProfile(value === "__manual__"); setProfile(value === "__manual__" ? "" : value); }} />
          <Button variant="secondary" disabled={busy || profilesLoading} onClick={() => setProfileRevision(value => value + 1)}>{t("cookies.refreshProfiles")}</Button>
        </Flex>
        <Text size="xs" tone="muted" className="cookie-profile-help">{t(profilesLoading ? "cookies.profilesLoading" : profiles.error
          ? profiles.error : profiles.profiles.length ? "cookies.profilesHelp" : "cookies.profilesEmpty")}</Text>
        {manualProfile && <Input label={t("cookies.profileManual")} value={profile} disabled={busy}
          placeholder={t("cookies.profilePlaceholder")} onChange={event => setProfile(event.target.value)} />}
      </Stack>}
      </>}
      <Text size="sm" aria-live="polite">{status
        ? t(selectedStatus?.configured ? "cookies.configured" : "cookies.none", { count: selectedStatus?.count ?? 0 })
        : t("cookies.loading")}</Text>
      {site !== "generic" && <><Text size="sm" className="cookie-application-status" aria-live="polite">
        {t(site === "chzzk" ? selectedStatus?.loginCookiesPresent ? "cookies.chzzkLoginPresent" : "cookies.chzzkLoginMissing"
          : status?.previewError ? "cookies.previewFailed" : status?.previewApplied ? "cookies.previewApplied" : "cookies.previewNotApplied")}
      </Text>
      <Text size="sm" className="cookie-browser-status" aria-live="polite">{t(checkingError ? "cookies.processCheckFailed"
        : browserRunning === null ? "cookies.checkingBrowser"
        : browserRunning ? "cookies.browserRunning" : "cookies.browserReady")}</Text></>}
      <Flex gap="sm" wrap className="cookie-actions">
        {site !== "generic" && <Button aria-busy={busy} disabled={busy} onClick={() => void change("browser")}>{t("cookies.extract")}</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => void change("file")}>{t("cookies.importFile")}</Button>
        <Button variant="secondary" disabled={busy || (!selectedStatus?.configured && !error && !selectedStatus?.error)} onClick={() => void change("clear")}>{t("cookies.clear")}</Button>
        <Button variant="ghost" onClick={() => void window.ytClipper.openExternalUrl(site !== "youtube" ? "https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp" : "https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies")}>
          {t("cookies.help")}
        </Button>
      </Flex>
      <Text size="xs" tone="muted">{t("cookies.appliesImmediately")}</Text>
      <div className="cookie-feedback" role="status" aria-live="polite" aria-atomic="true">
        <Text size="sm">{busy && !closeBrowserAction ? t("cookies.working") : error ? t(error) : notice ? t(notice) : "\u00a0"}</Text>
      </div>
      {site !== "generic" && platform === "darwin" && <Stack gap="sm" className="cookie-permission-help">
        <Text size="sm" tone="muted">{t("cookies.macPermissionHelp")}</Text>
        {development && <Text size="sm" tone="muted">{t("cookies.developmentPermissions")}</Text>}
        {development && runtimeAppPath && <Text size="xs" className="cookie-runtime-path">{runtimeAppPath}</Text>}
        <Flex gap="sm" wrap>
          <Button variant="secondary" disabled={busy || browser === "firefox" || browser === "safari"}
            onClick={() => void change("access")}>{t("cookies.requestAccess")}</Button>
          <Button variant="secondary" onClick={() => void openPermissions("keychain")}>{t("cookies.openKeychain")}</Button>
          <Button variant="secondary" onClick={() => void openPermissions("files")}>{t("cookies.openFilePermissions")}</Button>
        </Flex>
      </Stack>}
    </Stack>
    {closeBrowserAction && <BrowserClosePrompt browser={browser === "firefox" ? "Firefox" : browser[0].toUpperCase() + browser.slice(1)}
      platform={platform} busy={busy} onCancel={() => setCloseBrowserAction(null)} onRetry={() => void change(closeBrowserAction)}
      // Keep the last confirmed status during a retry; brief checks must not flash different text.
      message={t(checkingError ? "cookies.processCheckFailed" : browserRunning === false
        ? "cookies.browserReady" : browserRunning ? "cookies.browserRunning" : "cookies.checkingBrowser")} />}
  </Surface>;
}
