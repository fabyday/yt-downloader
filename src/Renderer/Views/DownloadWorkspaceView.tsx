import { Box, Grid, Head, Text } from "@kawaikara/kawai-ui";
import { DependencyStatus, WorkspaceTransitionSurface } from "../Components";
import { useI18n } from "../I18nProvider";
import { DownloadSetupView } from "./DownloadSetupView";

interface DownloadWorkspaceViewProps {
  active: boolean;
}

export function DownloadWorkspaceView({ active }: DownloadWorkspaceViewProps) {
  const { t } = useI18n();

  return (
    <WorkspaceTransitionSurface
      active={active}
      className="download-workspace-view"
      direction="right"
      role="region"
      ariaLabel={t("download.panelLabel")}
    >
      <Grid columns={2} align="center" className="download-workspace-header">
        <Box className="download-workspace-heading">
          <Text size="xs" weight="semibold" className="download-eyebrow">
            {t("app.eyebrow")}
          </Text>
          <Head level={1} size="lg">
            {t("app.title")}
          </Head>
          <Text size="sm" tone="muted">
            {t("download.workspaceDescription")}
          </Text>
        </Box>
        <DependencyStatus />
      </Grid>

      <DownloadSetupView />
    </WorkspaceTransitionSurface>
  );
}
