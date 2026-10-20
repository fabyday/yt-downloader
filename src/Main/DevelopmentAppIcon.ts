import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { nativeImage } from "electron";
import type { DevelopmentAppIcon } from "./DevelopmentConnection";

/**
 * Reads the product icon once per process startup and hashes normalized PNG pixels.
 * Missing assets explicitly clear the host cache; unreadable assets retain the previous
 * cache via the caller's undefined result. Never fall back to Electron's executable icon.
 * @param file Bundled app-owned PNG asset, not a path supplied by another application.
 */
export async function readDevelopmentAppIcon(file: string): Promise<DevelopmentAppIcon | null> {
  try {
    if ((await stat(file)).size > 32768) throw new Error("App icon asset is too large.");
    const image = nativeImage.createFromBuffer(await readFile(file));
    if (image.isEmpty()) throw new Error("Invalid app icon asset.");
    const bytes = image.resize({ width: 64, height: 64 }).toPNG();
    if (bytes.length > 32768) throw new Error("App icon payload is too large.");
    return { hash: createHash("sha256").update(bytes).digest("hex"), png: bytes.toString("base64") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
