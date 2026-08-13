import {
  Button,
  Code,
  Grid,
  Input,
  Panel,
  Select,
  Stack,
  Surface,
  Text,
  type SelectOption,
} from "@kawaikara/kawai-ui";
import type { SupportedLocale } from "../../Shared/locale";
import type { AppPreferences } from "../../Shared/types";
import { useI18n } from "../I18nProvider";

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
  ];

  return (
    <Grid columns={2} gap="md" className="preference-general-grid">
      <Stack gap="md">
        <Panel padding="md" radius="md" className="preference-section-card">
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
          </Stack>
        </Panel>

        <Panel padding="md" radius="md" className="preference-section-card">
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
      </Stack>

      <Stack gap="md">
        <Panel padding="md" radius="md" className="preference-section-card">
          <Stack gap="md">
            <Text size="md" weight="semibold">
              {t("preference.playbackSteps")}
            </Text>
            <Text size="sm" tone="muted">
              {t("preference.playbackStepsDescription")}
            </Text>
            <Grid columns={2} gap="sm" className="preference-number-grid">
              <Input
                type="number"
                min="0.01"
                max="3600"
                step="0.1"
                label={t("preference.largeStep")}
                value={preferences.seekLargeSeconds}
                onChange={(event) =>
                  onChange({ seekLargeSeconds: Number(event.target.value) })
                }
              />
              <Input
                type="number"
                min="0.01"
                max="3600"
                step="0.1"
                label={t("preference.smallStep")}
                value={preferences.seekSmallSeconds}
                onChange={(event) =>
                  onChange({ seekSmallSeconds: Number(event.target.value) })
                }
              />
            </Grid>
            <Input
              type="number"
              min="1"
              max="240"
              step="1"
              label={t("preference.frameRate")}
              description={t("preference.frameRateDescription")}
              value={preferences.frameRate}
              onChange={(event) =>
                onChange({ frameRate: Number(event.target.value) })
              }
            />
          </Stack>
        </Panel>

        <Panel padding="md" radius="md" className="preference-section-card">
          <Stack gap="sm">
            <Text size="md" weight="semibold">
              {t("preference.shortcuts")}
            </Text>
            <ShortcutRow label={t("shortcut.focusUrl")} keys="⌘/Ctrl + L" />
            <ShortcutRow label={t("shortcut.newTab")} keys="⌘/Ctrl + T" />
            <ShortcutRow label={t("shortcut.playPause")} keys="Space" />
            <ShortcutRow label={t("shortcut.smallStep")} keys="← / →" />
            <ShortcutRow label={t("shortcut.fineStep")} keys="[ / ]" />
            <ShortcutRow label={t("shortcut.largeStep")} keys="Shift + ← / →" />
            <ShortcutRow label={t("shortcut.frameStep")} keys="Alt + ← / →" />
          </Stack>
        </Panel>
      </Stack>
    </Grid>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <Surface padding="sm" radius="sm" tone="muted" className="shortcut-row">
      <Text size="sm">{label}</Text>
      <Code>{keys}</Code>
    </Surface>
  );
}
