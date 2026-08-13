import { Box, Button, Stack, Surface, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { Caption } from "./Caption";

export function RangeEditor() {
  const { t } = useI18n();

  return (
    <Box as="section" className="markers" aria-label={t("range.label")}>
      <Surface padding="sm" radius="md" className="markers-header">
        <Stack gap="xs">
          <Caption>{t("range.label")}</Caption>
          <Text as="div" weight="semibold" id="rangeSummary" className="range-value">
            {t("range.fullVideo")}
          </Text>
        </Stack>
        <Button id="resetSelectionButton" variant="ghost" size="sm">
          {t("range.reset")}
        </Button>
      </Surface>

      <Surface padding="sm" radius="md" className="marker-row">
        <Stack gap="xs">
          <Caption>{t("range.start")}</Caption>
          <Text
            as="div"
            weight="semibold"
            id="startTime"
            className="marker-value time-drag-handle"
            role="slider"
            tabIndex={0}
            aria-label={t("range.dragStart")}
            title={t("range.dragStart")}
          >
            --:--.---
          </Text>
        </Stack>
        <Button id="setStartButton" variant="secondary" size="sm">
          {t("range.current")}
        </Button>
      </Surface>

      <Surface padding="sm" radius="md" className="marker-row">
        <Stack gap="xs">
          <Caption>{t("range.end")}</Caption>
          <Text
            as="div"
            weight="semibold"
            id="endTime"
            className="marker-value time-drag-handle"
            role="slider"
            tabIndex={0}
            aria-label={t("range.dragEnd")}
            title={t("range.dragEnd")}
          >
            --:--.---
          </Text>
        </Stack>
        <Button id="setEndButton" variant="secondary" size="sm">
          {t("range.current")}
        </Button>
      </Surface>
    </Box>
  );
}
