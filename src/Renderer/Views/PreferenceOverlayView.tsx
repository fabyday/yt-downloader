import {
  Box,
  Button,
  Flex,
  Head,
  ScrollArea,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from "@kawaikara/kawai-ui";
import { useEffect, useState } from "react";
import { DEFAULT_APP_PREFERENCES, normalizeAppPreferences } from "../../Shared/preferences";
import type { AppPreferences } from "../../Shared/types";
import {
  PreferenceAppInfo,
  PreferenceGeneralSettings,
} from "../Components";
import { useI18n } from "../I18nProvider";
import { PreferenceCookies } from "../Components/PreferenceCookies";
import { PreferenceShortcuts } from "../Components/PreferenceShortcuts";

interface PreferenceOverlayViewProps {
  onClose: () => void;
  open: boolean;
}

export function PreferenceOverlayView({
  onClose,
  open,
}: PreferenceOverlayViewProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AppPreferences>(DEFAULT_APP_PREFERENCES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void window.ytClipper.getPreferences().then((preferences) => {
      if (active) setDraft(normalizeAppPreferences(preferences));
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      active = false;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const updateDraft = (updates: Partial<AppPreferences>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  const chooseDirectory = async () => {
    const directory = await window.ytClipper.selectOutputDir(draft.locale);
    if (directory) updateDraft({ defaultOutputDir: directory });
  };

  const save = async () => {
    setSaving(true);
    try {
      setDraft(await window.ytClipper.updatePreferences(draft));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      position="fixed"
      className="preference-overlay-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="preference-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferenceOverlayTitle"
      >
        <Flex align="start" justify="between" gap="md" className="preference-overlay-header">
          <Stack gap="xs">
            <Text size="xs" weight="semibold" className="download-eyebrow">
              {t("preference.windowEyebrow")}
            </Text>
            <Head id="preferenceOverlayTitle" level={1} size="lg">
              {t("preference.windowTitle")}
            </Head>
            <Text size="sm" tone="muted">
              {t("preference.windowDescription")}
            </Text>
          </Stack>
          <Button
            variant="secondary"
            size="md"
            className="preference-close-button"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            × {t("common.close")}
          </Button>
        </Flex>

        <Tabs defaultValue="general" className="preference-tabs">
          <TabList className="preference-tab-list">
            <Tab value="general">{t("preference.generalTab")}</Tab>
            <Tab value="cookies">{t("preference.cookiesTab")}</Tab>
            <Tab value="shortcuts">{t("preference.shortcuts")}</Tab>
            <Tab value="app-info">{t("preference.appInfoTab")}</Tab>
          </TabList>
          <ScrollArea className="preference-overlay-scroll" scrollbar="thin">
            <TabPanel value="general" className="preference-tab-panel">
              <PreferenceGeneralSettings
                preferences={draft}
                onChange={updateDraft}
                onChooseDirectory={() => void chooseDirectory()}
              />
            </TabPanel>
            <TabPanel value="cookies" className="preference-tab-panel">
              <PreferenceCookies />
            </TabPanel>
            <TabPanel value="app-info" className="preference-tab-panel">
              <PreferenceAppInfo
                automaticUpdates={draft.automaticUpdates}
                onAutomaticUpdatesChange={(automaticUpdates) =>
                  updateDraft({ automaticUpdates })
                }
              />
            </TabPanel>
            <TabPanel value="shortcuts" className="preference-tab-panel">
              <PreferenceShortcuts bindings={draft.shortcuts} onChange={shortcuts => updateDraft({ shortcuts })} />
            </TabPanel>
          </ScrollArea>
        </Tabs>

        <Flex justify="end" gap="sm" className="preference-overlay-footer">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button isLoading={saving} onClick={() => void save()}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </Flex>
      </section>
    </Box>
  );
}
