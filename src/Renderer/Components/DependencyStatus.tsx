import { Badge, Box, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";

export function DependencyStatus() {
  const { t } = useI18n();

  return (
    <Box as="section" className="status-panel" aria-label={t("dependency.label")}>
      <Badge
        id="ytDlpStatus"
        className="dependency missing"
        tone="danger"
        dot
      >
        <Text as="span" size="sm" weight="semibold" className="dependency-label">
          {t("dependency.checking", { name: "yt-dlp" })}
        </Text>
      </Badge>
      <Badge
        id="ffmpegStatus"
        className="dependency missing"
        tone="danger"
        dot
      >
        <Text as="span" size="sm" weight="semibold" className="dependency-label">
          {t("dependency.checking", { name: "ffmpeg" })}
        </Text>
      </Badge>
    </Box>
  );
}
