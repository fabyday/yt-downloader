import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAppPreferences } from "../Shared/preferences";

// Read before Electron is ready; PreferenceManager loads the same file later.
export function readHardwareAccelerationPreference(userDataDirectory: string): boolean {
  try {
    return normalizeAppPreferences(
      JSON.parse(readFileSync(join(userDataDirectory, "preferences.json"), "utf8")),
    ).hardwareAcceleration;
  } catch {
    return true;
  }
}
