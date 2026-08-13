import {
  Button,
  Grid,
  Input,
  Label,
  Panel,
  Stack,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";

export function DownloadDestinationSettings() {
  const { t } = useI18n();

  return (
    <Panel
      padding="md"
      radius="md"
      className="download-config-card download-destination-settings"
    >
      <Stack gap="xs" className="download-config-heading">
        <Text size="md" weight="semibold" className="download-config-title">
          {t("download.destinationTitle")}
        </Text>
        <Text size="sm" tone="muted" className="download-config-description">
          {t("download.destinationDescription")}
        </Text>
      </Stack>

      <Input
        id="basenameInput"
        type="text"
        label={t("download.basename")}
        placeholder={t("download.basenamePlaceholder")}
        autoComplete="off"
      />

      <Stack gap="xs" className="field">
        <Label htmlFor="outputDirInput">{t("download.outputFolder")}</Label>
        <Grid columns={2} gap="sm" className="folder-row">
          <Input id="outputDirInput" type="text" readOnly />
          <Button id="selectFolderButton" variant="secondary" size="md">
            {t("download.chooseFolder")}
          </Button>
        </Grid>
      </Stack>
    </Panel>
  );
}
