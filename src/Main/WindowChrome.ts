import type { BrowserWindowConstructorOptions, WebContents } from "electron";

// Keep these heights in sync with the chrome variables in Renderer/styles.css.
export const TITLE_BAR_HEIGHT = 40;
export const TAB_STRIP_HEIGHT = 48;
export const SHELL_CHROME_HEIGHT = TITLE_BAR_HEIGHT + TAB_STRIP_HEIGHT;

export function getWindowChromeOptions(
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#111317",
      symbolColor: "#cdd5df",
      height: TITLE_BAR_HEIGHT,
    },
    ...(platform === "darwin" ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
  };
}

// Removing the application menu also removes its macOS editing accelerators.
// Handle them on each WebContents, including the focused editor child view.
export function installMacWindowShortcuts(
  contents: WebContents,
  closeWindow: () => void,
  quit: () => void,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "darwin") return;
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.meta || input.control || input.alt) return;
    const key = input.key.toLowerCase();
    if (input.shift && key !== "z") return;
    const actions: Record<string, () => void> = {
      a: () => contents.selectAll(),
      c: () => contents.copy(),
      v: () => contents.paste(),
      x: () => contents.cut(),
      z: () => input.shift ? contents.redo() : contents.undo(),
      w: closeWindow,
      q: quit,
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  });
}
