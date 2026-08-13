import {
  Badge,
  Button,
  Flex,
  Panel,
  Stack,
  Surface,
  Switch,
  Text,
} from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import type { AppInfo, AppUpdateInfo } from "../../Shared/types";
import { useI18n } from "../I18nProvider";

interface PreferenceAppInfoProps {
  automaticUpdates: boolean;
  onAutomaticUpdatesChange: (checked: boolean) => void;
}

export function PreferenceAppInfo({
  automaticUpdates,
  onAutomaticUpdatesChange,
}: PreferenceAppInfoProps) {
  const { t } = useI18n();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);

  useEffect(() => {
    let active = true;
    void window.ytClipper.getAppInfo().then((info) => {
      if (active) setAppInfo(info);
    });
    if (automaticUpdates) {
      setChecking(true);
      void window.ytClipper.checkForUpdates().then((result) => {
        if (active) {
          setUpdate(result);
          setChecking(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      setUpdate(await window.ytClipper.checkForUpdates());
    } finally {
      setChecking(false);
    }
  };

  return (
    <Stack gap="md" className="preference-app-info">
      <Panel padding="lg" radius="md" className="app-identity-card">
        <Stack gap="xs">
          <Text size="xs" weight="semibold" className="download-eyebrow">
            YT SECTION DOWNLOADER
          </Text>
          <Text size="lg" weight="semibold">
            {appInfo?.name ?? t("app.documentTitle")}
          </Text>
          <Flex align="center" gap="sm" wrap>
            <Badge>{t("preference.version", { version: appInfo?.version ?? "…" })}</Badge>
            <Badge>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : "…"}</Badge>
          </Flex>
        </Stack>
      </Panel>

      <Panel padding="md" radius="md" className="preference-section-card">
        <Stack gap="md">
          <Switch
            checked={automaticUpdates}
            label={t("preference.automaticUpdates")}
            description={t("preference.automaticUpdatesDescription")}
            onCheckedChange={onAutomaticUpdatesChange}
          />
          <Flex align="center" gap="sm" justify="between" className="update-action-row">
            <Button isLoading={checking} onClick={() => void checkForUpdates()}>
              {checking
                ? t("preference.checkingUpdates")
                : t("preference.checkUpdates")}
            </Button>
            {update?.status === "available" && update.releaseUrl ? (
              <Button
                variant="secondary"
                onClick={() => void window.ytClipper.openExternalUrl(update.releaseUrl!)}
              >
                {t("preference.openRelease")}
              </Button>
            ) : null}
          </Flex>
          {update ? (
            <Surface
              padding="md"
              radius="sm"
              tone="muted"
              className={update.status === "error" ? "update-status-error" : undefined}
              aria-live="polite"
            >
              <Stack gap="xs">
                <Text size="sm" weight="semibold">
                  {t(`preference.updateStatus.${update.status}`)}
                </Text>
                <Text size="sm" tone="muted">
                  {update.latestVersion
                    ? t("preference.latestVersion", {
                        current: update.currentVersion,
                        latest: update.latestVersion,
                      })
                    : update.message}
                </Text>
              </Stack>
            </Surface>
          ) : null}
        </Stack>
      </Panel>
    </Stack>
  );
}
