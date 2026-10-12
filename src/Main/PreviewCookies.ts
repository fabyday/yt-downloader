import type { Session, CookiesSetDetails } from "electron";
import { normalizeCookieFile } from "../Worker/CookieStore";

// In-memory app-only session. Credentials are restored from the private Worker
// store on startup, never sent through the renderer IPC bridge.
export const PREVIEW_PARTITION = "youtube-preview";
const isYouTube = (domain: string) => {
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com");
};

export function previewCookieDetails(contents: string): CookiesSetDetails[] {
  return normalizeCookieFile(contents).contents.split(/\r?\n/).flatMap(line => {
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) return [];
    const [domain, subdomains, cookiePath, , expiry, name, value] = line.replace(/^#HttpOnly_/, "").split("\t");
    if (!isYouTube(domain)) return [];
    return [{ url: `https://${domain.replace(/^\./, "")}${cookiePath}`,
      ...(subdomains === "TRUE" ? { domain } : {}), path: cookiePath, name, value,
      httpOnly: line.startsWith("#HttpOnly_"), secure: true,
      // Netscape format lacks SameSite. The preview is a cross-site HTTPS embed.
      sameSite: "no_restriction" as const,
      ...(Number(expiry) > 0 ? { expirationDate: Number(expiry) } : {}),
    }];
  });
}

export async function applyPreviewCookies(target: Session, contents: string | null): Promise<number> {
  const incoming = contents ? previewCookieDetails(contents) : [];
  try {
    // Only YouTube credentials in our isolated app session; never Chrome's jar
    // or unrelated Google/account cookies. Also removes credentials on clear.
    for (const cookie of await target.cookies.get({})) {
      if (cookie.domain && isYouTube(cookie.domain)) await target.cookies.remove(
        `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`, cookie.name);
    }
    for (const cookie of incoming) await target.cookies.set(cookie);
    return incoming.length;
  } catch {
    // Do not leave a partially imported account authenticated after an error.
    try {
      for (const cookie of await target.cookies.get({})) {
        if (cookie.domain && isYouTube(cookie.domain)) await target.cookies.remove(
          `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`, cookie.name);
      }
    } catch { /* Report the generic failure below; never expose cookie details. */ }
    // Electron cookie errors can contain the rejected cookie: never propagate them.
    throw new Error("cookies.previewFailed");
  }
}
