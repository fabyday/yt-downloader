export const DEFAULT_SHORTCUTS = {
  focusUrl: "CmdOrCtrl+L", newTab: "CmdOrCtrl+T", playPause: "Space",
  smallBack: "ArrowLeft", smallForward: "ArrowRight",
  fineBack: "[", fineForward: "]",
  largeBack: "Shift+ArrowLeft", largeForward: "Shift+ArrowRight",
  frameBack: "Alt+ArrowLeft", frameForward: "Alt+ArrowRight",
  setStart: "A", setEnd: "S",
  modeClamp: "Q", modeFollow: "W", modeFree: "E",
};
export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type ShortcutBindings = Record<ShortcutAction, string>;
export const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[];

export function canonicalShortcut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "") return "";
  const parts = value.split("+");
  const key = parts.pop()!;
  if (!/^(?:[A-Z0-9]|\[|\]|Space|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|F(?:[1-9]|1[0-2]))$/.test(key)) return null;
  const modifiers = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];
  if (parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length) return null;
  return [...modifiers.filter(part => parts.includes(part)), key].join("+");
}

export function normalizeShortcuts(value: unknown): ShortcutBindings {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_SHORTCUTS };
  const used = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const key = canonicalShortcut(stored[action]) ?? DEFAULT_SHORTCUTS[action];
    result[action] = key && used.has(key) ? "" : key;
    if (result[action]) used.add(result[action]);
  }
  return result;
}

export function platformShortcut(binding: string, isMac: boolean): string {
  return [...new Set(binding.split("+").map(part => part === "CmdOrCtrl" ? isMac ? "Meta" : "Ctrl" : part))].join("+");
}

export function isProtectedShortcut(binding: string, isMac: boolean): boolean {
  const resolved = platformShortcut(binding, isMac);
  return new RegExp(`^${isMac ? "Meta" : "Ctrl"}\\+(?:[ACVXZQW]|Shift\\+Z)$`).test(resolved) ||
    (!isMac && resolved === "Alt+F4");
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, isMac: boolean): string | null {
  if (!isMac && event.metaKey) return null;
  const key = event.code === "Space" ? "Space"
    : event.code === "BracketLeft" ? "[" : event.code === "BracketRight" ? "]"
    : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key;
  return canonicalShortcut([
    (isMac ? event.metaKey : event.ctrlKey) ? "CmdOrCtrl" : "",
    isMac && event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key,
  ].filter(Boolean).join("+"));
}
