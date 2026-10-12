import * as path from "node:path";

export type BinaryName = "yt-dlp" | "ffmpeg";

export function managedBinaryPath(options: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
  platform: string;
  arch: string;
}, name: BinaryName): string {
  const target = `${options.platform}-${options.arch}`;
  const directory = options.packaged
    ? path.join(options.resourcesPath, "binaries", target)
    : path.join(options.appPath, ".cache", "build-binaries", target);
  return path.join(directory, name + (options.platform === "win32" ? ".exe" : ""));
}
