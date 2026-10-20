import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cookieImportToNetscape, type CookieImportData } from '../Shared/cookies';
import { parseVideoSource } from '../Shared/VideoSource';
import { normalizeCookieFile } from './CookieStore';

/** Ephemeral, request/source-bound credentials. Never merged into the user's cookie store. */
export class CompanionCookies {
  private readonly records = new Map<string, { sourceKey: string; contents: string | null; expires: number }>();

  /**
   * Stores validated credentials for one authenticated handoff, or an explicit public-only decision.
   * @param id - Main-owned request correlation identity.
   * @param url - Original source; unrelated URLs cannot use this snapshot.
   * @param data - Optional cookies approved by Kawaikara; null means denied/unavailable.
   */
  set(id: string, url: string, data: CookieImportData | null): void {
    const source = parseVideoSource(url);
    if (!/^[a-zA-Z0-9-]{1,160}$/.test(id) || !source) throw new Error('Invalid companion cookie context.');
    let contents: string | null = null;
    if (data) {
      try { contents = normalizeCookieFile(cookieImportToNetscape(data), Date.now(), 1024 * 1024, source.site).contents; }
      catch { contents = null; } // Invalid/empty optional credentials must not block public content.
    }
    for (const [key, record] of this.records) if (record.expires < Date.now()) this.records.delete(key);
    if (this.records.size >= 128 && !this.records.has(id)) this.records.delete(this.records.keys().next().value!);
    this.records.set(id, { sourceKey: source.key, contents, expires: Date.now() + 60 * 60 * 1000 });
  }

  /** Creates a private disposable yt-dlp jar only for this request's exact source. */
  async snapshot(id: string, url: string): Promise<{ path: string; dispose: () => Promise<void> } | null> {
    const record = this.records.get(id);
    if (!record || record.expires < Date.now() || record.sourceKey !== parseVideoSource(url)?.key || !record.contents) return null;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kawaikara-handoff-'));
    const filename = path.join(directory, 'cookies.txt');
    const dispose = () => fs.rm(directory, { recursive: true, force: true });
    try {
      await fs.chmod(directory, 0o700);
      await fs.writeFile(filename, record.contents, { mode: 0o600, flag: 'wx' });
      return { path: filename, dispose };
    } catch (error) { await dispose(); throw error; }
  }
}
