import {
  Box,
  Flex,
  Pressable,
  Slider,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { TimelineRulerContent } from "./TimelineRulerContent";
import { TimelineSegmentContent } from "./TimelineSegmentContent";

export function Timeline() {
  const { t } = useI18n();

  return (
    <Box as="section" className="timeline-panel" aria-label={t("timeline.label")}>
      <Flex align="center" justify="between" gap="sm" className="timeline-meta">
        <Flex align="center" gap="sm" className="timeline-ruler-heading">
          <Text as="span" size="sm" tone="muted">{t("timeline.ruler")}</Text>
          <Text as="span" size="xs" tone="muted" className="timeline-zoom-hint">
            {t("timeline.zoomHint")}
          </Text>
        </Flex>
        <Flex align="center" gap="xs" className="timeline-ruler-tools">
          <Text as="span" size="xs" tone="muted" id="timelineViewportLabel">
            --:--.--- – --:--.---
          </Text>
          <Pressable
            id="timelineZoomOutButton"
            className="timeline-zoom-button"
            aria-label={t("timeline.zoomOut")}
            title={t("timeline.zoomOut")}
          >
            −
          </Pressable>
          <Pressable
            id="timelineZoomResetButton"
            className="timeline-zoom-reset"
            aria-label={t("timeline.zoomReset")}
            title={t("timeline.zoomReset")}
          >
            <Text as="span" size="xs" weight="semibold" id="timelineZoomLabel">
              1×
            </Text>
          </Pressable>
          <Pressable
            id="timelineZoomInButton"
            className="timeline-zoom-button"
            aria-label={t("timeline.zoomIn")}
            title={t("timeline.zoomIn")}
          >
            +
          </Pressable>
          <Text as="div" weight="semibold" id="durationTime" className="timeline-duration">
            --:--.---
          </Text>
        </Flex>
      </Flex>
      <Pressable
        id="timelineRuler"
        className="timeline-ruler"
        cursor="grab"
        radius="sm"
        role="slider"
        aria-label={t("timeline.dragRuler")}
        title={t("timeline.dragRuler")}
      >
        <Box position="absolute" className="timeline-ruler-ticks">
          <TimelineRulerContent />
        </Box>
        <Box position="absolute" id="timelineRulerPlayhead" className="timeline-ruler-playhead" />
      </Pressable>
      <Box id="timelineShell" position="relative" className="timeline-shell">
        <Box position="relative" className="timeline-track" aria-hidden="true">
          <Box position="absolute" id="timelineSegments" className="timeline-segments">
            <TimelineSegmentContent />
          </Box>
          <Box position="absolute" id="timelineRange" className="timeline-range hidden" />
          <Box position="absolute" id="timelineFill" className="timeline-fill" />
        </Box>
        <Pressable
          id="startMarkerHandle"
          className="timeline-marker timeline-marker-start hidden"
          aria-label={t("timeline.adjustStart")}
        />
        <Pressable
          id="endMarkerHandle"
          className="timeline-marker timeline-marker-end hidden"
          aria-label={t("timeline.adjustEnd")}
        />
        <Slider
          id="timelineInput"
          className="timeline-input"
          containerClassName="timeline-slider-control"
          trackClassName="timeline-native-track"
          controlSize="sm"
          min={0}
          max={0}
          step={0.01}
          defaultValue={0}
          aria-label={t("timeline.position")}
          disabled
        />
        <Box
          id="currentTimeAnchor"
          position="absolute"
          className="timeline-current-anchor hidden"
        >
          <Box position="absolute" className="timeline-current-line" />
          <Pressable
            id="currentTimeHandle"
            className="timeline-current-knob"
            role="slider"
            aria-label={t("playback.dragPosition")}
            title={t("playback.dragPosition")}
          />
          <Text as="span" size="xs" weight="semibold" className="timeline-seeking-label">
            {t("timeline.seeking")}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
