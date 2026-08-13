import { Box, Button, Flex, Stack, Switch, Text } from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { Caption } from "./Caption";

export function PlaybackControls() {
  const { t } = useI18n();

  return (
    <Box as="section" className="transport" aria-label={t("playback.controls")}>
      <Stack gap="xs" className="time-readout">
        <Caption>{t("playback.currentPosition")}</Caption>
        <Text
          as="div"
          weight="semibold"
          id="currentTime"
          className="time-value time-drag-handle"
          role="slider"
          tabIndex={0}
          aria-label={t("playback.dragPosition")}
          title={t("playback.dragPosition")}
        >
          00:00.000
        </Text>
      </Stack>

      <Flex justify="center" gap="sm" className="button-row">
        <Button
          id="backLargeButton"
          className="icon-button"
          variant="secondary"
          size="sm"
          title={t("playback.backSeconds", { seconds: 10 })}
        >
          −10
        </Button>
        <Button
          id="backSmallButton"
          className="icon-button"
          variant="secondary"
          size="sm"
          title={t("playback.backSeconds", { seconds: 1 })}
        >
          −1
        </Button>
        <Button
          id="backFrameButton"
          className="icon-button frame-step-button"
          variant="secondary"
          size="sm"
          title={t("playback.backFrame")}
        >
          −1f
        </Button>
        <Button id="playPauseButton" className="control-button" size="md">
          {t("playback.play")}
        </Button>
        <Button
          id="forwardFrameButton"
          className="icon-button frame-step-button"
          variant="secondary"
          size="sm"
          title={t("playback.forwardFrame")}
        >
          +1f
        </Button>
        <Button
          id="forwardSmallButton"
          className="icon-button"
          variant="secondary"
          size="sm"
          title={t("playback.forwardSeconds", { seconds: 1 })}
        >
          +1
        </Button>
        <Button
          id="forwardLargeButton"
          className="icon-button"
          variant="secondary"
          size="sm"
          title={t("playback.forwardSeconds", { seconds: 10 })}
        >
          +10
        </Button>
      </Flex>

      <Switch
        id="loopToggle"
        label={t("playback.loop")}
        className="loop-toggle"
      />
    </Box>
  );
}
