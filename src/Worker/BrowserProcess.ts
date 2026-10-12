import { execFile } from "node:child_process";
import { browserCookieSpec, type BrowserCookieOptions, type CookieBrowser } from "../Shared/cookies";

const executables: Record<CookieBrowser, RegExp> = {
  chrome: /^(?:Google Chrome(?: Helper.*)?|chrome(?:\.exe)?)$/i,
  edge: /^(?:Microsoft Edge(?: Helper.*)?|msedge(?:\.exe)?)$/i,
  brave: /^(?:Brave Browser(?: Helper.*)?|brave(?:-browser)?(?:\.exe)?)$/i,
  firefox: /^(?:Firefox|firefox(?:\.exe)?|firefox-bin|plugin-container)$/i,
  chromium: /^(?:Chromium(?: Helper.*)?|chromium(?:-browser)?(?:\.exe)?)$/i,
  opera: /^(?:Opera(?: Helper.*)?|opera(?:\.exe)?)$/i,
  vivaldi: /^(?:Vivaldi(?: Helper.*)?|vivaldi(?:-bin)?(?:\.exe)?)$/i,
  safari: /^Safari$/i,
};

export function hasBrowserProcess(browser: CookieBrowser, output: string, platform: string): boolean {
  return output.split(/\r?\n/).some(line => {
    const name = platform === "win32" ? line.match(/^"([^"]+)"/)?.[1]
      : line.trim().split("/").at(-1);
    return Boolean(name && executables[browser].test(name));
  });
}

export async function getBrowserProcessStatus(options: BrowserCookieOptions): Promise<{ running: boolean }> {
  browserCookieSpec(options);
  const windows = process.platform === "win32";
  const output = await new Promise<string>((resolve, reject) => {
    execFile(windows ? "tasklist.exe" : "/bin/ps", windows ? ["/FO", "CSV", "/NH"] : ["-axo", "comm="],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error ? reject(new Error("cookies.processCheckFailed")) : resolve(stdout));
  });
  return { running: hasBrowserProcess(options.browser, output, process.platform) };
}
