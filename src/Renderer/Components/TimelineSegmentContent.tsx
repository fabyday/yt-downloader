import { Box } from "@kawaikara/kawai-ui";
import { useRendererViewSnapshot } from "../viewStore";

export function TimelineSegmentContent() {
  const { timelineSegments } = useRendererViewSnapshot();

  return (
    <>
      {timelineSegments.map((segment) => (
        <Box
          key={`${segment.id}-${segment.pulseRevision}`}
          position="absolute"
          className={`timeline-segment${segment.highlighted ? " highlighted" : ""}`}
          style={{
            backgroundColor: segment.color,
            left: segment.left,
            width: segment.width,
          }}
        />
      ))}
    </>
  );
}
