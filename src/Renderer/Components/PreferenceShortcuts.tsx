import { Button, Flex, Stack, Text } from "@kawaikara/kawai-ui";
import { useState } from "react";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, shortcutFromEvent, platformShortcut, isProtectedShortcut, type ShortcutAction, type ShortcutBindings } from "../../Shared/shortcuts";
import { useI18n } from "../I18nProvider";
import { ShortcutKeycaps } from "./ShortcutKeycaps";

export function PreferenceShortcuts({ bindings, onChange }: {
  bindings: ShortcutBindings; onChange: (value: ShortcutBindings) => void;
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<{ action: ShortcutAction; duplicate?: ShortcutAction; message: string } | null>(null);
  const platform = new URLSearchParams(window.location.search).get("platform");
  const isMac = platform ? platform === "darwin" : /Mac/i.test(navigator.platform);
  const assign = (action: ShortcutAction, value: string) => {
    const duplicate = SHORTCUT_ACTIONS.find(other => other !== action && value && platformShortcut(bindings[other], isMac) === platformShortcut(value, isMac));
    if (duplicate) { setError({ action, duplicate, message: t("shortcut.duplicate", { action: t(`shortcut.action.${duplicate}`) }) }); return; }
    setError(null); setRecording(null); onChange({ ...bindings, [action]: value });
  };
  return <Stack gap="sm" className="preference-shortcuts">
    <Text size="md" weight="semibold">{t("preference.shortcuts")}</Text>
    <Text size="xs" tone="muted">{t("shortcut.editHelp")}</Text>
    {SHORTCUT_ACTIONS.map(action => <Stack gap="xs" key={action} data-shortcut-action={action}
      className={`shortcut-entry ${error?.action === action || error?.duplicate === action ? "shortcut-conflict" : ""}`}>
      <Flex className="shortcut-row" gap="sm" align="center" justify="between">
      <Text size="sm">{t(`shortcut.action.${action}`)}</Text>
      <Flex gap="xs" align="center">
        <Button size="sm" variant="secondary" className="shortcut-binding-button" aria-label={t(`shortcut.action.${action}`)}
          aria-invalid={error?.action === action || error?.duplicate === action || undefined}
          onBlur={() => setRecording(null)}
          onClick={() => { setRecording(action); setError(null); }}
          onKeyDown={event => {
            if (recording !== action) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setRecording(null); return; }
            if (event.key === "Backspace" || event.key === "Delete") { assign(action, ""); return; }
            if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
            const key = shortcutFromEvent(event.nativeEvent, isMac);
            if (!key || isProtectedShortcut(key, isMac)) {
              setError({ action, message: t("shortcut.unsupported") }); return;
            }
            assign(action, key);
          }}>
          {recording === action ? t("shortcut.recording") : bindings[action]
            ? <ShortcutKeycaps keys={bindings[action]} /> : t("shortcut.unassigned")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => assign(action, DEFAULT_SHORTCUTS[action])}>{t("shortcut.reset")}</Button>
      </Flex>
      </Flex>
      {error?.action === action && <Text size="sm" role="alert">{error.message}</Text>}
    </Stack>)}
    <Button variant="secondary" onClick={() => { setError(null); setRecording(null); onChange({ ...DEFAULT_SHORTCUTS }); }}>{t("shortcut.resetAll")}</Button>
  </Stack>;
}
