import {
  Box,
  Flex,
  Panel,
  ScrollArea,
  Stack,
  Surface,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import {
  getRendererViewActions,
  useRendererViewSnapshot,
} from "../viewStore";

export function DownloadSegmentPlan() {
  const { t } = useI18n();
  const { downloadSegmentItems, downloadSegmentSummary } =
    useRendererViewSnapshot();
  const actions = getRendererViewActions();

  return (
    <Panel
      padding="md"
      radius="md"
      className="download-config-card download-segment-plan"
    >
      <Stack gap="xs" className="download-config-heading">
        <Flex align="center" justify="between" gap="sm">
          <Text size="md" weight="semibold" className="download-config-title">
            {t("download.sectionsTitle")}
          </Text>
          <Text size="xs" tone="muted" className="download-segment-total">
            {t("download.sectionsSummary", {
              count: downloadSegmentSummary.count,
              duration: downloadSegmentSummary.duration,
            })}
          </Text>
        </Flex>
        <Text size="sm" tone="muted" className="download-config-description">
          {t("download.sectionsDescription")}
        </Text>
      </Stack>

      <ScrollArea
        className="download-segment-list"
        label={t("download.sectionsTitle")}
        scrollbar="thin"
      >
        {downloadSegmentItems.length === 0 ? (
          <Text size="sm" tone="muted">
            {t("download.sectionsEmpty")}
          </Text>
        ) : (
          <Stack gap="sm">
            {downloadSegmentItems.map((segment) => (
            <Surface
              key={segment.id}
              padding="sm"
              radius="sm"
              role="button"
              tabIndex={0}
              className="download-segment-row"
              aria-label={t("segments.focus", { title: segment.title })}
              onClick={() => actions.focusDownloadSegment(segment.sourceSegmentId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  actions.focusDownloadSegment(segment.sourceSegmentId);
                }
              }}
            >
              <Box
                className="segment-color-swatch"
                aria-hidden="true"
                style={{ backgroundColor: segment.color }}
              />
              <Stack gap="xs" className="download-segment-row-main">
                <Text size="sm" weight="semibold" title={segment.title}>
                  {segment.title}
                </Text>
                <Text size="xs" tone="muted">
                  {segment.times}
                </Text>
              </Stack>
              <Text size="sm" weight="semibold" className="download-segment-duration">
                {segment.duration}
              </Text>
            </Surface>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Panel>
  );
}
