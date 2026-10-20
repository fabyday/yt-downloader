import { Badge, Button, Flex, Panel, SocialBadge, Stack, Switch, Text } from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import type { AppInfo, AppUpdateInfo } from "../../Shared/types";
import { useI18n } from "../I18nProvider";
import { YtDlpUpdateInfo } from "./YtDlpUpdateInfo";

interface PreferenceAppInfoProps {
  automaticUpdates: boolean;
  onAutomaticUpdatesChange: (checked: boolean) => void;
}

const links = [
  { brand: "website", url: "https://kawaikara.github.io/" },
  { brand: "github", url: "https://github.com/fabyday/yt-downloader" },
  { brand: "discord", url: "https://discord.gg/JJs974BX45" },
  { brand: "youtube", url: "https://www.youtube.com/@molera1708" },
] as const;

export function PreferenceAppInfo({ automaticUpdates, onAutomaticUpdatesChange }: PreferenceAppInfoProps) {
  const { t } = useI18n();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const [ffmpeg, setFfmpeg] = useState("…");
  useEffect(() => {
    let active = true;
    void window.ytClipper.getAppInfo().then(info => { if (active) setAppInfo(info); })
      .catch(() => { if (active) setLoadFailed(true); });
    void window.ytClipper.getDependencyStatus().then(info => {
      if (active) setFfmpeg(info.ffmpeg.version || t("appInfo.unavailable"));
    }).catch(() => { if (active) setFfmpeg(t("appInfo.unavailable")); });
    if (automaticUpdates) {
      setChecking(true);
      void window.ytClipper.checkForUpdates().then(result => { if (active) setUpdate(result); })
        .catch(() => { if (active) setUpdate({ status: "error", currentVersion: "", latestVersion: null, releaseUrl: null, message: "" }); })
        .finally(() => { if (active) setChecking(false); });
    }
    return () => { active = false; };
  }, []);
  const checkForUpdates = async () => {
    if (checking) return;
    setChecking(true);
    try { setUpdate(await window.ytClipper.checkForUpdates()); }
    catch { setUpdate({ status: "error", currentVersion: appInfo?.version ?? "", latestVersion: null, releaseUrl: null, message: "" }); }
    finally { setChecking(false); }
  };
  const openLink = async (url: string) => {
    setLinkFailed(false);
    try { if (!await window.ytClipper.openExternalUrl(url)) setLinkFailed(true); }
    catch { setLinkFailed(true); }
  };
  return <Stack gap="md" className="preference-app-info">
    <nav className="app-social-links" aria-label={t("appInfo.links")}>
      {links.map(link => <SocialBadge key={link.brand} brand={link.brand}
        label={t(`appInfo.link.${link.brand}`)} onClick={() => void openLink(link.url)} />)}
    </nav>
    {linkFailed && <Text size="sm" tone="danger" role="status">{t("appInfo.linkFailed")}</Text>}
    <Panel padding="lg" radius="md" className="app-identity-card">
      <Stack gap="md">
        <div className="app-info-header">
          <Flex align="center" gap="sm" className="app-info-identity">
            <img className="app-info-icon" src="./app-icon.png" alt="" draggable={false} />
            <Stack gap="xs">
              <Text size="lg" weight="semibold">{appInfo?.name ?? t("app.documentTitle")}</Text>
              <Text size="sm" tone="muted">{t("appInfo.description")}</Text>
            </Stack>
          </Flex>
          <Switch checked={automaticUpdates} label={t("preference.automaticUpdates")}
            title={t("preference.automaticUpdatesDescription")} onCheckedChange={onAutomaticUpdatesChange} />
        </div>
        <div className="app-info-detail-row app-info-release-row">
          <Text size="sm" tone="muted">{t("appInfo.version")}</Text>
          <Flex align="center" gap="sm" wrap>
            <Badge>{appInfo?.version ?? "…"}</Badge>
            <Button size="sm" variant="secondary" isLoading={checking} onClick={() => void checkForUpdates()}>
              {checking ? t("preference.checkingUpdates") : t("preference.checkUpdates")}
            </Button>
            {update?.status === "available" && update.releaseUrl && <Button size="sm" variant="secondary" onClick={() => void openLink(update.releaseUrl!)}>{t("preference.openRelease")}</Button>}
          </Flex>
        </div>
        <div className="app-info-detail-row">
          <Text size="sm" tone="muted">{t("appInfo.platform")}</Text>
          <Text size="sm">{appInfo ? `${appInfo.platform === "darwin" ? "macOS" : appInfo.platform === "win32" ? "Windows" : appInfo.platform} · ${appInfo.arch}` : "…"}</Text>
        </div>
        {appInfo?.electronVersion && <div className="app-info-detail-row">
          <Text size="sm" tone="muted">{t("appInfo.runtime")}</Text>
          <Text size="sm">Electron {appInfo.electronVersion} · Chromium {appInfo.chromeVersion}</Text>
        </div>}
        {loadFailed && <Text role="status" tone="danger" size="sm">{t("appInfo.unavailable")}</Text>}
        <div className="app-info-update-status" role="status" aria-live="polite">
          {update && <Stack gap="xs">
            <Text size="sm" tone={update.status === "error" ? "danger" : "muted"}>{t(`preference.updateStatus.${update.status}`)}</Text>
            {update.latestVersion && <Text size="xs" tone="muted">{t("preference.latestVersion", { current: update.currentVersion, latest: update.latestVersion })}</Text>}
          </Stack>}
        </div>
      </Stack>
    </Panel>
    <YtDlpUpdateInfo />
    <Panel padding="md" radius="md" className="preference-section-card">
      <div className="app-info-detail-row">
        <Text size="sm" weight="semibold">FFmpeg</Text>
        <Text size="xs" className="app-info-binary-version">{ffmpeg}</Text>
      </div>
    </Panel>
  </Stack>;
}
