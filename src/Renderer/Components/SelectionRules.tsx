import { Button, Flex, Panel, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { useRendererViewSnapshot } from "../viewStore";

export function SelectionRules() {
  const { t } = useI18n();
  const { selectionMode } = useRendererViewSnapshot();
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
    </Panel>
  );
}
