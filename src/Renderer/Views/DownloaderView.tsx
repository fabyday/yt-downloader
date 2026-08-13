import { KawaiProvider, Layout } from "@kawaikara/kawai-ui";
import { useCallback, useState } from "react";
import { SourceLoader } from "../Components";
import { DownloadWorkspaceView } from "./DownloadWorkspaceView";
import { YouTubeWorkspaceView } from "./YouTubeWorkspaceView";
import { PreferenceOverlayView } from "./PreferenceOverlayView";

export function DownloaderView() {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
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
          onOpenPreferences={() => setPreferencesOpen(true)}
          onToggleDownload={() => setDownloadOpen((open) => !open)}
        />
        <YouTubeWorkspaceView active={!downloadOpen} />
        <DownloadWorkspaceView active={downloadOpen} />
        <PreferenceOverlayView
          open={preferencesOpen}
          onClose={closePreferences}
        />
      </Layout>
    </KawaiProvider>
  );
}
