import { Box, Button, Flex, Stack, Surface, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import {
  getRendererViewActions,
  useRendererViewSnapshot,
} from "../viewStore";

export function SegmentListContent() {
  const { t } = useI18n();
  const { segmentItems } = useRendererViewSnapshot();
  const actions = getRendererViewActions();

  if (segmentItems.length === 0) {
    return <Text size="sm" tone="muted">{t("segments.empty")}</Text>;
  }

  return (
    <Stack gap="sm">
      {segmentItems.map((segment) => (
        <GridRow key={segment.id} segment={segment} actions={actions} />
      ))}
    </Stack>
  );
}

function GridRow({
  actions,
  segment,
}: {
  actions: ReturnType<typeof getRendererViewActions>;
  segment: ReturnType<typeof useRendererViewSnapshot>["segmentItems"][number];
}) {
  const { t } = useI18n();

  return (
    <Surface
      padding="none"
      radius="sm"
      className="segment-row segment-row-clickable"
      role="button"
      tabIndex={0}
      aria-label={t("segments.focus", { title: segment.title })}
      onClick={() => actions.previewSegment(segment.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          actions.previewSegment(segment.id);
        }
      }}
    >
      <Box
        className="segment-color-swatch"
        aria-hidden="true"
        style={{ backgroundColor: segment.color }}
      />
      <Stack gap="xs" className="segment-main">
        <Text as="div" size="sm" weight="semibold" className="segment-title">
          {segment.title}
        </Text>
        <Text as="div" size="xs" tone="muted" className="segment-times">
          {segment.times}
        </Text>
      </Stack>
      <Button
        size="sm"
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          actions.removeSegment(segment.id);
        }}
      >
        {t("common.delete")}
      </Button>
    </Surface>
  );
}
