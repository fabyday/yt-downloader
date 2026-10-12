import { spawn } from "node:child_process";
import * as path from "node:path";
import { browserCookieSpec, type BrowserCookieOptions } from "../Shared/cookies";

// Same Keychain account/service pairs used by yt-dlp on macOS.
const accounts: Partial<Record<BrowserCookieOptions["browser"], string>> = {
  chrome: "Chrome", chromium: "Chromium", edge: "Microsoft Edge",
  brave: "Brave", opera: "Opera", vivaldi: "Vivaldi",
};

// Resolve from the executable, not app.getAppPath() (the source folder in pnpm start).
export function macAppBundleForExecutable(executable: string): string | null {
  let directory = path.dirname(executable);
  while (directory !== path.dirname(directory)) {
    if (directory.endsWith(".app")) return directory;
    directory = path.dirname(directory);
  }
  return null;
}

export function requestCookieKeychainAccess(options: BrowserCookieOptions): Promise<void> {
  browserCookieSpec(options);
  const account = accounts[options.browser];
  if (process.platform !== "darwin" || !account) return Promise.reject(new Error("cookies.noKeychainRequest"));
  return new Promise((resolve, reject) => {
    // A protected read invokes macOS authorization if access is not already granted.
    // Discard the secret at the OS pipe boundary: never return, retain or log it.
    const child = spawn("/usr/bin/security", ["find-generic-password", "-w", "-a", account,
      "-s", `${account} Safe Storage`], { stdio: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("cookies.keychainAccessFailed")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("cookies.browserTimeout"));
      else if (code === 0) resolve();
      else reject(new Error(code === 44 ? "cookies.keychainMissing" : "cookies.keychainAccessFailed"));
    });
  });
}
