import { KawaiProvider, Layout } from "@kawaikara/kawai-ui";
import { BrowserTabStrip } from "../Components";

export function BrowserShellView() {
  return (
    <KawaiProvider reducedMotion="user">
      <Layout
        as="main"
        surface="background"
        className="browser-shell kawai-theme-dark downloader-theme"
      >
        <BrowserTabStrip />
      </Layout>
    </KawaiProvider>
  );
}
