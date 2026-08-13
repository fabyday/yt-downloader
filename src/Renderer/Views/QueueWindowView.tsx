import {
  Box,
  Head,
  KawaiProvider,
  Layout,
  Panel,
  Text,
} from "@kawaikara/kawai-ui";
import { useI18n } from "../I18nProvider";
import { DownloadQueueView } from "./DownloadQueueView";

export function QueueWindowView() {
  const { t } = useI18n();

  return (
    <KawaiProvider reducedMotion="user">
      <Layout
        as="main"
        minHeight="screen"
        surface="background"
        className="queue-window-shell kawai-theme-dark downloader-theme"
      >
        <Panel padding="md" radius="lg" className="queue-window-panel">
          <Box as="header" className="queue-window-header">
            <Box className="queue-window-heading-row">
              <Text size="xs" weight="semibold" className="download-eyebrow">
                {t("queue.windowEyebrow")}
              </Text>
              <Head level={1} size="lg">
                {t("queue.windowTitle")}
              </Head>
            </Box>
            <Text size="sm" tone="muted">
              {t("queue.windowDescription")}
            </Text>
          </Box>
          <DownloadQueueView />
        </Panel>
      </Layout>
    </KawaiProvider>
  );
}
