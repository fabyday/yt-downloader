import {
  Box,
  Button,
  Flex,
  Tab,
  TabList,
  Tabs,
  Text,
} from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import type { BrowserTabSnapshot } from "../../Shared/types";
import { useI18n } from "../I18nProvider";

const EMPTY_SNAPSHOT: BrowserTabSnapshot = {
  activeTabId: null,
  tabs: [],
};

export function BrowserTabStrip() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);

  useEffect(() => {
    let active = true;
    const removeListener = window.ytClipper.onBrowserTabsChanged((next) => {
      if (active) setSnapshot(next);
    });
    void window.ytClipper.getBrowserTabs().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      removeListener();
    };
  }, []);

  return (
    <Flex
      align="center"
      gap="xs"
      className="browser-tab-strip"
      aria-label={t("tabs.label")}
    >
      <Tabs
        value={snapshot.activeTabId ?? undefined}
        onValueChange={(tabId) => {
          void window.ytClipper.activateBrowserTab(tabId);
        }}
        className="browser-tabs"
        variant="pill"
      >
        <TabList className="browser-tab-list">
          {snapshot.tabs.map((tab) => (
            <Flex
              key={tab.id}
              align="center"
              className={`browser-tab-item${tab.active ? " active" : ""}`}
            >
              <Tab
                value={tab.id}
                className="browser-tab-button"
                title={tab.title}
              >
                <Text as="span" size="sm" className="browser-tab-title">
                  {tab.title}
                </Text>
              </Tab>
              <Button
                size="sm"
                variant="ghost"
                className="browser-tab-close"
                aria-label={t("tabs.close", { title: tab.title })}
                title={t("tabs.close", { title: tab.title })}
                onClick={() => {
                  void window.ytClipper.closeBrowserTab(tab.id);
                }}
              >
                ×
              </Button>
            </Flex>
          ))}
        </TabList>
      </Tabs>

      <Button
        id="newBrowserTabButton"
        size="sm"
        variant="secondary"
        className="new-browser-tab"
        aria-label={t("tabs.new")}
        title={t("tabs.new")}
        onClick={() => {
          void window.ytClipper.createBrowserTab();
        }}
      >
        +
      </Button>
      <Box className="browser-tab-strip-spacer" />
      <Text size="xs" weight="semibold" className="browser-shell-brand">
        YT SECTION DOWNLOADER
      </Text>
    </Flex>
  );
}
