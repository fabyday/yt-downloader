import { Grid } from "@kawaikara/kawai-ui";
import { SelectionRules } from "../Components/SelectionRules";
import {
  PlaybackControls,
  RangeEditor,
  SegmentEditor,
  Timeline,
  VideoPreview,
  WorkspaceTransitionSurface,
} from "../Components";

interface YouTubeWorkspaceViewProps {
  active: boolean;
  segmentsOpen: boolean;
}

export function YouTubeWorkspaceView({ active, segmentsOpen }: YouTubeWorkspaceViewProps) {
  return (
    <WorkspaceTransitionSurface
      active={active}
      className="workspace youtube-workspace-view"
      direction="left"
    >
      <div className={`preview-row${segmentsOpen ? " with-segments" : ""}`}>
        <VideoPreview />
        {/* Keep the existing player and imperative editor bindings mounted when toggling. */}
        <aside id="segmentSidebar" className="segment-sidebar" hidden={!segmentsOpen}>
          <SegmentEditor />
        </aside>
      </div>
      <Timeline />
      <PlaybackControls />
      <Grid columns={1} className="editor-dock">
        <SelectionRules />
        <RangeEditor />
      </Grid>
    </WorkspaceTransitionSurface>
  );
}
