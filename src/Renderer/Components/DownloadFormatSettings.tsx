import {
  Grid,
  Button,
  Panel,
  Stack,
  Surface,
  Text,
  type SelectOption,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { PresetDetailsContent } from "./PresetContent";
import { RendererSelect, setRendererSelectValue } from "./RendererSelect";
import { useRef, useState } from "react";
import { EXTRA_PRESETS, CUSTOM_EXTENSIONS, DEFAULT_CUSTOM_ARGS, PRESET_OPTIONS } from "../../Shared/encoding";

export function DownloadFormatSettings() {
  const { t } = useI18n();
  const [manual, setManual] = useState(false);
  const [sourcePreset, setSourcePreset] = useState("youtube-copy");
  const argsRef = useRef<HTMLTextAreaElement>(null);
  const copyPreset = () => {
    const preset = (document.getElementById("encodingPresetSelect") as HTMLButtonElement)?.value;
    if (argsRef.current) argsRef.current.value = PRESET_OPTIONS[preset] ?? DEFAULT_CUSTOM_ARGS;
    const extension = EXTRA_PRESETS.find(item => item.id === preset)?.extension ??
      (preset === "youtube-copy" ? "mkv" : preset === "h264-mp4" ? "mp4" : "mov");
    setRendererSelectValue(document.getElementById("customExtensionSelect") as HTMLButtonElement, extension);
    document.getElementById("customExtensionSelect")?.dispatchEvent(new Event("change", {bubbles:true}));
  };
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
        disabled={manual}
        label={t("download.preset")}
        options={presetOptions}
        defaultValue="youtube-copy"
        onValueChange={setSourcePreset}
      />

      <RendererSelect id="encodingModeSelect" label={t("encoding.mode")} defaultValue="preset"
        options={[{value:"preset",label:t("encoding.preset")},{value:"custom",label:t("encoding.custom")}]} onValueChange={value => setManual(value === "custom")} />
      <Stack gap="sm" className="manual-encoding" style={{ display: manual ? undefined : "none" }}>
        <Text size="xs" tone="muted">{t("encoding.help")}</Text>
        <Text size="sm" weight="semibold" id="customFfmpegArgsLabel">{t("encoding.options")}</Text>
        {/* KawaiUI has no multiline input yet; keep the native editable field. */}
        <textarea aria-labelledby="customFfmpegArgsLabel" id="customFfmpegArgs" ref={argsRef} rows={4} defaultValue={DEFAULT_CUSTOM_ARGS} spellCheck={false} />
        <RendererSelect id="customExtensionSelect" label={t("encoding.container")} defaultValue="mp4"
          options={CUSTOM_EXTENSIONS.map(extension => ({value:extension,label:extension.toUpperCase()}))} />
        <Button variant="secondary" size="sm" onClick={copyPreset}>{t("encoding.copyPreset")}</Button>
        <Text size="xs" tone="muted">{t("encoding.copyPresetHelp", { preset: presetOptions.find(option => option.value === sourcePreset)?.label ?? sourcePreset })}</Text>
      </Stack>

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

    </Panel>
  );
}
