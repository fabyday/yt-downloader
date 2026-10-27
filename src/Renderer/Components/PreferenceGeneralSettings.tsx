import {
  Button,
  Grid,
  Input,
  Panel,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@kawaikara/kawai-ui";
import type { SupportedLocale } from "../../Shared/locale";
import type { AppPreferences } from "../../Shared/types";
import { useI18n } from "../I18nProvider";
import { EXTRA_PRESETS } from "../../Shared/encoding";
import { PopupSelect as Select } from "./PopupSelect";
import { NumberInput } from "./NumberInput";
import { useEffect, useState } from "react";
import type { DevelopmentConnectionStatus } from "../../Shared/types";

interface PreferenceGeneralSettingsProps {
  preferences: AppPreferences;
  onChange: (updates: Partial<AppPreferences>) => void;
  onChooseDirectory: () => void;
}

export function PreferenceGeneralSettings({
  onChange,
  onChooseDirectory,
  preferences,
}: PreferenceGeneralSettingsProps) {
  const { t } = useI18n();
  const [development, setDevelopment] = useState(false);
  const [connection, setConnection] = useState<DevelopmentConnectionStatus>();
  useEffect(() => {
    let active = true;
    void window.ytClipper.getAppInfo().then((info) => {
      if (active) setDevelopment(info.isPackaged === false);
    }).catch(() => {});
    const refresh = () => {
      void window.ytClipper
        .developmentConnection("status")
        .then((state) => {
          if (active)
            setConnection((previous) => ({ ...state, hosts: previous?.directory === state.directory ? previous?.hosts : undefined }));
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const changeConnection = async (
    operation: "connect" | "disconnect" | "automatic" | "selectDirectory" | "installed",
    hostId?: string,
  ) => {
    if (openingKawaikara) return;
    setOpeningKawaikara(true);
    try {
      setConnection(
        await window.ytClipper.developmentConnection(operation, hostId),
      );
    } catch {
      setConnection(previous => ({ ...previous, development: previous?.development ?? true, state: "failed" }));
    } finally {
      setOpeningKawaikara(false);
    }
  };
  const [openingKawaikara, setOpeningKawaikara] = useState(false);
  const [kawaikaraStatus, setKawaikaraStatus] = useState<
    "opened" | "failed" | null
  >(null);
  const openKawaikara = async () => {
    if (openingKawaikara) return;
    setOpeningKawaikara(true);
    setKawaikaraStatus(null);
    try {
      setKawaikaraStatus(
        (await window.ytClipper.openKawaikara()) ? "opened" : "failed",
      );
    } catch {
      setKawaikaraStatus("failed");
    } finally {
      setOpeningKawaikara(false);
    }
  };
  const localeOptions: readonly SelectOption[] = [
    { value: "ko", label: t("locale.ko") },
    { value: "en", label: t("locale.en") },
    { value: "ja", label: t("locale.ja") },
  ];
  const qualityOptions: readonly SelectOption[] = [
    { value: "best", label: t("quality.best") },
    ...["2160", "1440", "1080", "720", "480", "360"].map((height) => ({
      value: height,
      label: t("quality.max", { height }),
    })),
  ];
  const speedOptions: readonly SelectOption[] = [
    { value: "", label: t("speed.unlimited") },
    ...["1M", "2M", "5M", "10M", "20M", "50M"].map((value) => ({
      value,
      label: `${value.replace("M", "")} MB/s`,
    })),
  ];
  const presetOptions: readonly SelectOption[] = [
    { value: "youtube-copy", label: t("preset.youtubeCopy.name") },
    { value: "h264-mp4", label: "H.264 MP4" },
    { value: "premiere-prores", label: "Premiere ProRes 422 HQ" },
    { value: "davinci-dnxhr", label: "DaVinci DNxHR HQX" },
    ...EXTRA_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.name,
    })),
  ];

  return (
    <Grid columns={2} gap="md" className="preference-general-grid">
      <Panel
        padding="md"
        radius="md"
        className="preference-section-card preference-application-card"
      >
        <Stack gap="md">
          <Text size="md" weight="semibold">
            {t("preference.application")}
          </Text>
          <Select
            id="preferenceLocaleSelect"
            label={t("locale.label")}
            options={localeOptions}
            value={preferences.locale}
            onValueChange={(locale) =>
              onChange({ locale: locale as SupportedLocale })
            }
          />
          <Input
            id="preferenceOutputDir"
            label={t("preference.defaultOutputDir")}
            value={preferences.defaultOutputDir}
            readOnly
            endAdornment={t("preference.folder")}
          />
          <Button variant="secondary" onClick={onChooseDirectory}>
            {t("preference.chooseDefaultFolder")}
          </Button>
          <Switch
            checked={preferences.hardwareAcceleration}
            label={t("preference.hardwareAcceleration")}
            description={t("preference.hardwareAccelerationDescription")}
            onCheckedChange={(hardwareAcceleration) =>
              onChange({ hardwareAcceleration })
            }
          />
        </Stack>
      </Panel>

      <Panel
        padding="md"
        radius="md"
        className="preference-section-card preference-default-card"
      >
        <Stack gap="md">
          <Text size="md" weight="semibold">
            {t("preference.defaultDownload")}
          </Text>
          <Grid columns={2} gap="sm" className="preference-default-grid">
            <Select
              label={t("download.quality")}
              options={qualityOptions}
              value={preferences.defaultDownloadQuality}
              onValueChange={(value) =>
                onChange({ defaultDownloadQuality: value })
              }
            />
            <Select
              label={t("download.speedLimit")}
              options={speedOptions}
              value={preferences.defaultSpeedLimit}
              onValueChange={(value) => onChange({ defaultSpeedLimit: value })}
            />
          </Grid>
          <Select
            label={t("download.preset")}
            options={presetOptions}
            value={preferences.defaultEncodingPreset}
            onValueChange={(value) =>
              onChange({ defaultEncodingPreset: value })
            }
          />
        </Stack>
      </Panel>
      <Panel
        padding="md"
        radius="md"
        className="preference-section-card preference-playback-card"
      >
        <Stack gap="md">
          <Text size="md" weight="semibold">
            {t("preference.playbackSteps")}
          </Text>
          <Text size="sm" tone="muted">
            {t("preference.playbackStepsDescription")}
          </Text>
          <Grid columns={2} gap="sm" className="preference-number-grid">
            <NumberInput
              min={0.01}
              max={3600}
              step={0.1}
              layout="stacked"
              label={t("preference.largeStep")}
              value={preferences.seekLargeSeconds}
              onValueChange={(value) => onChange({ seekLargeSeconds: value })}
            />
            <NumberInput
              min={0.01}
              max={3600}
              step={0.1}
              layout="stacked"
              label={t("preference.smallStep")}
              value={preferences.seekSmallSeconds}
              onValueChange={(value) => onChange({ seekSmallSeconds: value })}
            />
          </Grid>
          <NumberInput
            min={1}
            max={240}
            step={1}
            layout="stacked"
            label={t("preference.frameRate")}
            description={t("preference.frameRateDescription")}
            value={preferences.frameRate}
            onValueChange={(value) => onChange({ frameRate: value })}
          />
        </Stack>
      </Panel>

      <Panel
        padding="md"
        radius="md"
        className="preference-section-card preference-integration-card"
      >
        <Stack gap="md">
          <Text size="md" weight="semibold">
            {t("integration.title")}
          </Text>
          <Text size="sm" tone="muted">
            {t("integration.description")}
          </Text>
          {development && (
            <>
              <Button variant="secondary" disabled={openingKawaikara} onClick={() => void changeConnection("selectDirectory")}>
                {t("integration.dev.selectDirectory")}
              </Button>
              {connection?.directory && <Text size="xs" tone="muted">{connection.directory}</Text>}
            </>
          )}
          {development && connection?.development ? (
            <Stack gap="sm">
              <Text size="sm" tone="muted">
                {t(connection.requiresDirectory ? "integration.dev.chooseHelp" : "integration.dev.help")}
              </Text>
              <Switch
                label={t("integration.dev.automatic")}
                checked={connection.automatic !== false}
                disabled={openingKawaikara || connection.requiresDirectory || connection.state === "connecting"}
                onCheckedChange={(enabled) =>
                  void changeConnection("automatic", String(enabled))
                }
              />
              <Button
                id="developmentConnectionButton"
                variant="secondary"
                disabled={
                  openingKawaikara ||
                  connection.state === "connecting" ||
                  connection.state === "pendingDisconnect"
                }
                onClick={() =>
                  void changeConnection(
                    connection.hostId ? "disconnect" : "connect",
                  )
                }
              >
                {t(
                  connection.hostId
                    ? "integration.dev.disconnect"
                    : "integration.dev.connect",
                )}
              </Button>
              {connection.state === "selectHost" &&
                connection.hosts?.map((hostId) => (
                  <Button
                    key={hostId}
                    disabled={openingKawaikara}
                    variant="secondary"
                    onClick={() => void changeConnection("connect", hostId)}
                  >
                    Kawaikara Dev · {hostId.slice(0, 8)}
                  </Button>
                ))}
              <Button variant="ghost" disabled={openingKawaikara} onClick={() => void changeConnection("installed")}>
                {t("integration.dev.useInstalled")}
              </Button>
              <Text size="sm" role="status">
                {t(`integration.dev.${connection.state}`)}
              </Text>
            </Stack>
          ) : (
            <>
              <Button
                id="openKawaikaraButton"
                variant="secondary"
                disabled={openingKawaikara}
                onClick={() => void openKawaikara()}
              >
                {t("integration.open")}
              </Button>
              {kawaikaraStatus && (
                <Text
                  size="sm"
                  role="status"
                  tone={kawaikaraStatus === "failed" ? "danger" : "muted"}
                >
                  {t(`integration.${kawaikaraStatus}`)}
                </Text>
              )}
            </>
          )}
        </Stack>
      </Panel>
    </Grid>
  );
}
