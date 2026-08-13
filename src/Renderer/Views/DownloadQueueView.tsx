import {
  Box,
  Button,
  Code,
  Flex,
  Grid,
  Panel,
  Progress,
  ScrollArea,
  Stack,
  Surface,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { Caption, DownloadQueueContent } from "../Components";
import {
  getRendererViewActions,
  useRendererViewSnapshot,
} from "../viewStore";

export function DownloadQueueView() {
  const { t } = useI18n();
  const { queueItems } = useRendererViewSnapshot();
  const actions = getRendererViewActions();
  const selectedCount = queueItems.filter((item) => item.selected).length;

  return (
    <Grid columns={2} gap="md" className="queue-workspace-grid">
      <Panel padding="sm" radius="md" className="queue-list-pane">
        <Stack gap="sm" className="queue-list-stack">
          <Surface padding="sm" radius="md" className="queue-summary">
            <Caption>{t("queue.label")}</Caption>
            <Text as="div" weight="semibold" id="queueSummary" className="queue-summary-value">
              {t("queue.waitingSummary", { queued: 0 })}
            </Text>
          </Surface>

          <Flex align="center" gap="xs" wrap className="queue-batch-actions">
            <Button
              size="sm"
              variant="secondary"
              disabled={queueItems.length === 0}
              onClick={actions.selectAllQueueItems}
            >
              {t("queue.selectAll")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedCount === 0}
              onClick={actions.removeSelectedQueueItems}
            >
              {t("queue.deleteSelected", { count: selectedCount })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={queueItems.length === 0}
              onClick={actions.clearQueue}
            >
              {t("queue.clearAll")}
            </Button>
          </Flex>

          <ScrollArea
            id="queueList"
            className="queue-list empty"
            label={t("queue.label")}
            scrollbar="thin"
          >
            <DownloadQueueContent />
          </ScrollArea>
        </Stack>
      </Panel>

      <Panel padding="sm" radius="md" className="queue-detail-pane">
        <Stack gap="sm" className="queue-detail-stack">
          <Box as="section" className="progress-panel" aria-label={t("queue.currentProgress")}>
            <Progress
              aria-label={t("queue.downloadProgress")}
              value={0}
              size="md"
              indicatorClassName="progress-fill"
              indicatorProps={{ id: "progressFill" }}
            />
            <Text as="div" size="sm" weight="semibold" id="progressLabel" className="progress-label" aria-live="polite">
              {t("status.idle")}
            </Text>
            <Code block id="logOutput" className="log-output" />
          </Box>

          <Button
            id="openOutputButton"
            className="secondary-button"
            variant="secondary"
            fullWidth
            disabled
          >
            {t("queue.openOutput")}
          </Button>
        </Stack>
      </Panel>
    </Grid>
  );
}
