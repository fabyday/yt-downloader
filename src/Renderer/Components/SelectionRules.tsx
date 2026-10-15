import { Button, Flex, Panel, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { getRendererViewActions, useRendererViewSnapshot } from "../viewStore";

export function SelectionRules() {
  const { t } = useI18n();
  const { selectionMode, zoomPivot } = useRendererViewSnapshot();
  return (
    <Panel padding="sm" radius="md" className="selection-rules-panel" role="group" aria-labelledby="selectionRulesTitle">
      <Text id="selectionRulesTitle" size="sm" weight="semibold">{t("selection.rules")}</Text>
      <Flex className="selection-mode-controls" gap="xs">
        {(["clamp", "follow", "free"] as const).map(mode => (
          <Button key={mode} id={`selectionMode-${mode}`} size="sm"
            variant={selectionMode === mode ? "primary" : "secondary"}
            aria-pressed={selectionMode === mode} title={t(`selection.${mode}.help`)}>
            {t(`selection.${mode}`)}
          </Button>
        ))}
      </Flex>
      <Text id="zoomPivotTitle" size="sm" weight="semibold">{t("timeline.zoomPivot")}</Text>
      <Flex className="selection-mode-controls" gap="xs" role="group" aria-labelledby="zoomPivotTitle">
        {(["playhead", "start", "end"] as const).map(pivot => (
          <Button key={pivot} id={`zoomPivot-${pivot}`} size="sm"
            variant={zoomPivot === pivot ? "primary" : "secondary"} aria-pressed={zoomPivot === pivot}
            onClick={() => getRendererViewActions().setZoomPivot(pivot)}>{t(`timeline.pivot.${pivot}`)}</Button>
        ))}
      </Flex>
    </Panel>
  );
}
