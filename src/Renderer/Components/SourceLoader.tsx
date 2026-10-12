import { Badge, Button, Grid, Input } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { useRendererViewSnapshot } from "../viewStore";

interface SourceLoaderProps {
  downloadOpen: boolean;
  segmentsOpen: boolean;
  onToggleSegments: () => void;
  onOpenPreferences: () => void;
  onToggleDownload: () => void;
}

export function SourceLoader({
  downloadOpen,
  segmentsOpen,
  onToggleSegments,
  onOpenPreferences,
  onToggleDownload,
}: SourceLoaderProps) {
  const { t } = useI18n();
  const { queueItems } = useRendererViewSnapshot();
  const activeQueueCount = queueItems.filter(
    (item) => item.status === "queued" || item.status === "running",
  ).length;

  return (
    <Grid columns={6} align="end" className="input-bar source-toolbar">
      <Input
        id="urlInput"
        type="url"
        label={t("source.urlLabel")}
        placeholder={t("source.urlPlaceholder")}
        autoComplete="off"
        controlSize="lg"
      />
      <Button id="loadButton" size="lg" className="primary-button" disabled={downloadOpen}>
        {t("source.load")}
      </Button>
      <Button
        id="toggleDownloadPanelButton"
        size="lg"
        variant={downloadOpen ? "primary" : "secondary"}
        aria-pressed={downloadOpen}
        onClick={onToggleDownload}
      >
        {downloadOpen ? t("viewer.backToYouTube") : t("viewer.download")}
      </Button>
      <Button
        id="openQueueWindowButton"
        size="lg"
        variant="secondary"
        onClick={() => void window.ytClipper.openQueueWindow()}
      >
        {t("viewer.queue")}
        <Badge size="sm" className="toolbar-queue-badge">
          {activeQueueCount}
        </Badge>
      </Button>
      <Button
        id="openPreferenceOverlayButton"
        size="lg"
        variant="secondary"
        onClick={onOpenPreferences}
      >
        {t("viewer.preference")}
      </Button>
      <Button id="toggleSegmentListButton" size="lg" variant={segmentsOpen ? "primary" : "secondary"}
        aria-pressed={segmentsOpen} aria-controls="segmentSidebar" disabled={downloadOpen} onClick={onToggleSegments}>
        {t("segments.showList")}
      </Button>
    </Grid>
  );
}
