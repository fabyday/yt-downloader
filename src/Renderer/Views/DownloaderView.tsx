import { KawaiProvider, Layout } from "@kawaikara/kawai-ui";
import { useCallback, useEffect, useState } from "react";
import { useRendererViewSnapshot } from "../viewStore";
import { SourceLoader } from "../Components";
import { DownloadWorkspaceView } from "./DownloadWorkspaceView";
import { YouTubeWorkspaceView } from "./YouTubeWorkspaceView";
import { PreferenceOverlayView } from "./PreferenceOverlayView";

export function DownloaderView() {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(true);
  const { segmentNotice } = useRendererViewSnapshot();
  // Reveal the local notice without transferring keyboard focus to the panel.
  useEffect(() => { if (segmentNotice) setSegmentsOpen(true); }, [segmentNotice]);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  return (
    <KawaiProvider reducedMotion="user">
      <Layout
        as="main"
        minHeight="screen"
        surface="background"
        className={`app-shell kawai-theme-dark downloader-theme ${
          downloadOpen ? "show-download-view" : "show-youtube-view"
        }`}
      >
        <SourceLoader
          downloadOpen={downloadOpen}
          segmentsOpen={segmentsOpen}
          onToggleSegments={() => setSegmentsOpen(open => !open)}
          onOpenPreferences={() => setPreferencesOpen(true)}
          onToggleDownload={() => setDownloadOpen((open) => !open)}
        />
        <YouTubeWorkspaceView active={!downloadOpen} segmentsOpen={segmentsOpen} />
        <DownloadWorkspaceView active={downloadOpen} />
        <PreferenceOverlayView
          open={preferencesOpen}
          onClose={closePreferences}
        />
      </Layout>
    </KawaiProvider>
  );
}
