import {
  Button,
  Flex,
  Panel,
  ScrollArea,
  Stack,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { Caption } from "./Caption";
import { SegmentListContent } from "./SegmentListContent";

export function SegmentEditor() {
  const { t } = useI18n();

  return (
    <Panel padding="sm" radius="md" className="segment-panel">
      <Flex align="center" justify="between" className="segment-panel-header">
        <Stack gap="xs">
          <Caption>{t("segments.label")}</Caption>
          <Text as="div" weight="semibold" id="segmentCount" className="segment-count-value">
            {t("segments.count", { count: 0 })}
          </Text>
        </Stack>
        <Flex gap="sm" className="segment-actions">
          <Button id="addSegmentButton" size="sm">
            {t("segments.add")}
          </Button>
          <Button id="clearSegmentsButton" variant="ghost" size="sm">
            {t("segments.clear")}
          </Button>
        </Flex>
      </Flex>
      <ScrollArea
        id="segmentList"
        className="segment-list empty"
        label={t("segments.listLabel")}
        scrollbar="thin"
      >
        <SegmentListContent />
      </ScrollArea>
    </Panel>
  );
}
