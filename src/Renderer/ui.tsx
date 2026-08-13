import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { RendererViewMode } from "../Shared/types";
import { I18nProvider } from "./I18nProvider";
import {
  BrowserShellView,
  DownloaderView,
  QueueWindowView,
} from "./Views";

export { setRendererSelectValue } from "./Components";

export function mountRendererUi(mode: RendererViewMode): void {
  document.body.dataset.view = mode;
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Renderer root element was not found.");
  }

  const root = createRoot(container);
  const view =
    mode === "shell" ? (
      <BrowserShellView />
    ) : mode === "queue" ? (
      <QueueWindowView />
    ) : (
      <DownloaderView />
    );
  flushSync(() => {
    root.render(<I18nProvider>{view}</I18nProvider>);
  });
}
