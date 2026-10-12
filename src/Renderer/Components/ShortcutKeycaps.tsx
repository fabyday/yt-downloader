/** Platform-native key labels, matching Kawaikara dev3's shortcut keycaps. */
export function ShortcutKeycaps({ keys }: { keys: string }) {
  const platform = new URLSearchParams(window.location.search).get("platform");
  const isMac = platform ? platform === "darwin" : /Mac/i.test(navigator.platform);
  const labels: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
    CmdOrCtrl: isMac ? "⌘" : "Ctrl",
    Ctrl: isMac ? "⌃" : "Ctrl",
    Alt: isMac ? "⌥" : "Alt",
    Shift: isMac ? "⇧" : "Shift",
  };
  const parts = keys.split(/\s*([+/])\s*/).filter(Boolean);
  return (
    <span className="shortcut-key-group">
      {parts.map((part, index) =>
        part === "+" ? null : part === "/" ? (
          <span className="shortcut-key-separator" key={index}>/</span>
        ) : (
          <kbd key={index}>{labels[part] ?? part}</kbd>
        ),
      )}
    </span>
  );
}
