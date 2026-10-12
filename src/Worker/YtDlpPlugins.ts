import * as path from "node:path";
import { parseVideoSource } from "../Shared/VideoSource";

/** Python cannot read Electron ASAR archives; these assets are explicitly unpacked. */
export function ytDlpSiteArgs(url: string): string[] {
  if (parseVideoSource(url)?.site !== "chzzk") return [];
  const directory = path.join(__dirname, "yt-dlp-plugins")
    .replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return ["--no-plugin-dirs", "--plugin-dirs", directory];
}
