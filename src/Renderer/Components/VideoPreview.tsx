import {
  AspectRatio,
  Box,
  Center,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";

export function VideoPreview() {
  const { t } = useI18n();

  return (
    <Box className="preview-pane">
      <AspectRatio
        id="playerStage"
        className="player-stage"
        role="button"
        tabIndex={0}
        aria-label={t("video.togglePlayback")}
      >
        <Box className="player-viewport">
          <Center id="player" className="player-placeholder">
            <Center className="player-placeholder-icon" aria-hidden="true">
              ▶
            </Center>
            <Text as="span" size="sm" tone="muted">{t("video.placeholder")}</Text>
          </Center>
        </Box>
      </AspectRatio>
    </Box>
  );
}
