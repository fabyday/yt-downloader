import { KawaiProvider, Layout } from "@kawaikara/kawai-ui";
import { BrowserTabStrip } from "../Components";
import { WindowTitleBar } from "../Components/WindowTitleBar";

export function BrowserShellView() {
  return (
    <KawaiProvider reducedMotion="user">
      <Layout
        as="main"
        surface="background"
        className="browser-shell kawai-theme-dark downloader-theme"
      >
        <WindowTitleBar />
        <BrowserTabStrip />
      </Layout>
    </KawaiProvider>
  );
}
