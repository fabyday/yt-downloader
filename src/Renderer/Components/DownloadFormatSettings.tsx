import {
  Box,
  Grid,
  Panel,
  ScrollArea,
  Stack,
  Surface,
  Text,
  type SelectOption,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { Caption } from "./Caption";
import { PresetDetailsContent, PresetFormatContent } from "./PresetContent";
import { RendererSelect } from "./RendererSelect";

export function DownloadFormatSettings() {
  const { t } = useI18n();
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
    <Panel
      padding="md"
      radius="md"
      className="download-config-card download-format-settings"
    >
      <Stack gap="xs" className="download-config-heading">
        <Text size="md" weight="semibold" className="download-config-title">
          {t("download.optionsTitle")}
        </Text>
        <Text size="sm" tone="muted" className="download-config-description">
          {t("download.optionsDescription")}
        </Text>
      </Stack>

      <Grid columns={2} gap="sm" className="option-grid">
        <RendererSelect
          id="downloadQualitySelect"
          label={t("download.quality")}
          options={qualityOptions}
          defaultValue="best"
        />
        <RendererSelect
          id="speedLimitSelect"
          label={t("download.speedLimit")}
          options={speedOptions}
          defaultValue=""
        />
      </Grid>

      <RendererSelect
        id="encodingPresetSelect"
        label={t("download.preset")}
        options={presetOptions}
        defaultValue="youtube-copy"
      />

      <Surface
        id="presetDetails"
        padding="sm"
        radius="sm"
        tone="muted"
        className="preset-details"
        aria-live="polite"
      >
        <PresetDetailsContent />
      </Surface>

      <Box as="section" className="format-list">
        <Caption>{t("download.formats")}</Caption>
        <ScrollArea
          id="presetFormatList"
          className="format-list-body"
          label={t("download.formats")}
          scrollbar="thin"
        >
          <PresetFormatContent />
        </ScrollArea>
      </Box>
    </Panel>
  );
}
