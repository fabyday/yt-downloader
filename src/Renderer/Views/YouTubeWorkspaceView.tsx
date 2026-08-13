import { Grid } from "@kawaikara/kawai-ui";
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
}

export function YouTubeWorkspaceView({ active }: YouTubeWorkspaceViewProps) {
  return (
    <WorkspaceTransitionSurface
      active={active}
      className="workspace youtube-workspace-view"
      direction="left"
    >
      <VideoPreview />
      <Timeline />
      <PlaybackControls />
      <Grid columns={2} className="editor-dock">
        <RangeEditor />
        <SegmentEditor />
      </Grid>
    </WorkspaceTransitionSurface>
  );
}
