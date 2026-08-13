import { Box, Text } from "@kawaikara/kawai-ui";
import { useRendererViewSnapshot } from "../viewStore";

export function TimelineRulerContent() {
  const { timelineRulerItems } = useRendererViewSnapshot();

  return (
    <>
      {timelineRulerItems.map((tick) => (
        <Box
          key={tick.id}
          position="absolute"
          className={`timeline-ruler-tick ${tick.major ? "major" : "minor"}`}
          style={{ left: tick.left }}
          aria-hidden="true"
        >
          <Box className="timeline-ruler-tick-line" />
          {tick.label ? (
            <Text as="span" size="xs" className="timeline-ruler-tick-label">
              {tick.label}
            </Text>
          ) : null}
        </Box>
      ))}
    </>
  );
}
