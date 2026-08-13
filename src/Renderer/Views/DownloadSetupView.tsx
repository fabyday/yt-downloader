import { Box, Button, Grid, Surface } from "@kawaikara/kawai-ui";
import {
  DownloadDestinationSettings,
  DownloadFormatSettings,
  DownloadSegmentPlan,
} from "../Components";
import { useI18n } from "../I18nProvider";

export function DownloadSetupView() {
  const { t } = useI18n();

  return (
    <Box className="download-setup-workspace">
      <Grid columns={3} gap="md" className="download-config-grid">
        <DownloadDestinationSettings />
        <DownloadSegmentPlan />
        <DownloadFormatSettings />
      </Grid>

      <Grid columns={2} gap="sm" className="download-config-footer">
        <Surface
          id="setupStatusLabel"
          padding="sm"
          radius="md"
          tone="muted"
          className="setup-status"
          aria-live="polite"
        >
          {t("status.idle")}
        </Surface>
        <Button id="downloadButton" className="download-button" size="lg" fullWidth>
          {t("download.addSelection")}
        </Button>
      </Grid>
    </Box>
  );
}
