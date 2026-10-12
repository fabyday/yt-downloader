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
    ...EXTRA_PRESETS.map(preset => ({ value: preset.id, label: preset.name })),
  ];

  return (
    <Grid columns={2} gap="md" className="preference-general-grid">
        <Panel padding="md" radius="md" className="preference-section-card preference-application-card">
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

        <Panel padding="md" radius="md" className="preference-section-card preference-default-card">
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
        <Panel padding="md" radius="md" className="preference-section-card preference-playback-card">
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
                onValueChange={(value) =>
                  onChange({ seekLargeSeconds: value })
                }
              />
              <NumberInput
                min={0.01}
                max={3600}
                step={0.1}
                layout="stacked"
                label={t("preference.smallStep")}
                value={preferences.seekSmallSeconds}
                onValueChange={(value) =>
                  onChange({ seekSmallSeconds: value })
                }
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
              onValueChange={(value) =>
                onChange({ frameRate: value })
              }
            />
          </Stack>
        </Panel>

    </Grid>
  );
}
