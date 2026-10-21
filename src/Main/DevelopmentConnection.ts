import {
  isRevoked,
  revokeBinding,
  readRecord,
  writeRecord,
} from "./LocalConnectionRecords";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseDownloaderDeepLink } from "./ExternalProtocol";
import type { DevelopmentConnectionStatus } from "../Shared/types";

const APP_ID = "day.faby.kawai-downloader";
interface Host {
  hostId: string;
  endpoint: string;
  token: string;
  automatic?: boolean;
}
interface State {
  clientId: string;
  key: string;
  hostId?: string;
  pendingDisconnect?: boolean;
  automatic?: boolean;
  blockedAutomatic?: boolean;
}
export interface DevelopmentAppIcon {
  hash: string;
  png: string;
}
interface Reply {
  iconNeeded?: boolean;
  connected?: boolean;
  requests?: { id: string; deepLink: string }[];
}

/**
 * Discovers running development hosts; every new binding still requires host permission consent.
 * Credentials stay in Main/private local storage. No URI wake, shell execution or
 * production fallback is performed by this transport.
 */
export class DevelopmentConnection {
  private state: State = {
    clientId: randomUUID(),
    key: randomBytes(32).toString("hex"),
  };
  private current: DevelopmentConnectionStatus["state"] = "disconnected";
  private readonly presenceToken = randomBytes(32).toString("hex");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  private icon?: DevelopmentAppIcon | null;
  private readonly abort = new AbortController();
  private readonly received = new Map<string, boolean>();

  /**
   * @param file Private persistent identity of this development environment.
   * @param open Main-owned receiver; returns only after accepting a deep-link handoff.
   * @param directory Per-user host discovery directory, overridable for integration tests.
   */
  constructor(
    private readonly file: string,
    private readonly open: (url: string) => void,
    private readonly directory: string,
    private readonly readIcon?: () => Promise<
      DevelopmentAppIcon | null | undefined
    >,
  ) {}

  /** Restores approved bindings and, when enabled, discovers a single unambiguous running host. */
  async start(): Promise<void> {
    this.icon = await this.readIcon?.().catch(() => undefined);
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (
        !/^[a-f0-9-]{36}$/.test(value.clientId) ||
        !/^[a-f0-9]{64}$/.test(value.key) ||
        (value.hostId !== undefined && !/^[a-f0-9-]{36}$/.test(value.hostId))
      )
        throw new Error("Invalid development connection state.");
      this.state = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.save();
    await writeRecord(
      path.join(this.directory, "clients", `${this.state.clientId}.json`),
      {
        schemaVersion: 1,
        clientId: this.state.clientId,
        appId: APP_ID,
        pid: process.pid,
        token: this.presenceToken,
      },
    );
    this.current = this.state.hostId ? "waiting" : "disconnected";
    this.timer = setInterval(() => {
      void this.tick();
    }, 1500);
    this.timer.unref();
    await this.tick();
  }

  /** Public snapshot deliberately excludes endpoints and credentials. */
  status(): DevelopmentConnectionStatus {
    return {
      development: true,
      state: this.current,
      hostId: this.state.hostId,
      automatic: this.state.automatic !== false,
    };
  }

  /** Lists running hosts; stale, malformed, non-private or non-loopback records are ignored. */
  private async hosts(): Promise<Host[]> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const hosts: Host[] = [];
    for (const name of names
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .slice(0, 64)) {
      try {
        const file = path.join(this.directory, name);
        const info = await stat(file);
        if (
          info.size > 4096 ||
          (process.platform !== "win32" &&
            ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
        )
          continue;
        const value = JSON.parse(await readFile(file, "utf8"));
        if (
          value.schemaVersion !== 1 ||
          value.mode !== "development" ||
          name !== `${value.hostId}.json` ||
          !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value.endpoint) ||
          !/^[a-f0-9]{64}$/.test(value.token) ||
          !Number.isSafeInteger(value.pid) ||
          value.pid < 1
        )
          continue;
        process.kill(value.pid, 0);
        hosts.push(value);
      } catch {
        /* A closed or invalid host is not a connection candidate. */
      }
    }
    return hosts;
  }

  /** Starts explicit consent. Multiple running hosts must be selected by the user. */
  async connect(hostId?: string): Promise<DevelopmentConnectionStatus> {
    await this.waitForIdle();
    if (this.stopped) return this.status();
    this.busy = true;
    this.current = "connecting";
    try {
      if (this.state.pendingDisconnect) {
        this.current = "pendingDisconnect";
        return this.status();
      }
      const hosts = await this.hosts();
      const host = hostId
        ? hosts.find((item) => item.hostId === hostId)
        : (hosts.find((item) => item.hostId === this.state.hostId) ??
          (hosts.length === 1 ? hosts[0] : undefined));
      if (!host) {
        this.current = hosts.length > 1 ? "selectHost" : "waiting";
        return { ...this.status(), hosts: hosts.map((item) => item.hostId) };
      }
      if (this.state.hostId && this.state.hostId !== host.hostId) {
        this.current = "disconnectFirst";
        return this.status();
      }
      if (!this.state.hostId) {
        // A failed/declined initial attempt must not prompt repeatedly in the background.
        this.state.blockedAutomatic = true;
        await this.save();
      }
      const result = await this.post(host, "/connect", {}, 125000);
      if (this.stopped) return this.status();
      if (result.connected !== true) {
        this.current = "denied";
        return this.status();
      }
      this.state.hostId = host.hostId;
      if (
        await isRevoked(
          this.directory,
          host.hostId,
          this.state.clientId,
          this.state.key,
        )
      ) {
        await this.clearBinding();
        return this.status();
      }
      await this.save();
      this.current = "connected";
      await this.supplyIcon(host, result);
    } catch {
      this.current = "failed";
    } finally {
      this.busy = false;
    }
    return this.status();
  }

  /** Persists automatic discovery preference independently of an existing approved binding. */
  async setAutomatic(enabled: boolean): Promise<DevelopmentConnectionStatus> {
    await this.waitForIdle();
    this.state.automatic = enabled;
    // Enabling discovery does not silently undo an explicit disconnect or denied consent.
    await this.save();
    return this.status();
  }

  /** Publishes durable revocation before clearing local credentials, even if the host is stopped. */
  async disconnect(): Promise<DevelopmentConnectionStatus> {
    await this.waitForIdle();
    if (this.stopped) return this.status();
    this.busy = true;
    try {
      if (this.state.hostId)
        await revokeBinding(
          this.directory,
          this.state.hostId,
          this.state.clientId,
          this.state.key,
        );
      await this.clearBinding();
    } finally {
      this.busy = false;
    }
    return this.status();
  }

  /** Keeps explicit disconnect/remote revocation sticky until the user requests a new handshake. */
  private async clearBinding(): Promise<void> {
    delete this.state.hostId;
    delete this.state.pendingDisconnect;
    this.state.key = randomBytes(32).toString("hex");
    this.state.blockedAutomatic = true;
    this.current = "disconnected";
    this.received.clear();
    await this.save();
  }

  /** Stops reconnection before application teardown without revoking the saved binding. */
  async dispose(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.timer);
    await rm(
      path.join(this.directory, "clients", `${this.state.clientId}.json`),
      { force: true },
    ).catch(() => {});
  }

  /** User commands wait for background polling rather than being silently discarded. */
  private async waitForIdle(): Promise<void> {
    while (this.busy && !this.stopped)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }

  /** Polls the pinned host; unavailable hosts remain registered and revoked hosts do not re-register. */
  private async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    if (!this.state.hostId) {
      try {
        const invitationFile = path.join(
          this.directory,
          "invitations",
          `${this.state.clientId}.json`,
        );
        const invitation = await readRecord(invitationFile);
        if (
          invitation?.token === this.presenceToken &&
          typeof invitation.hostId === "string" &&
          typeof invitation.createdAt === "number" &&
          Math.abs(Date.now() - invitation.createdAt) < 30000
        ) {
          await rm(invitationFile, { force: true });
          await this.connect(invitation.hostId);
        } else if (
          this.state.automatic !== false &&
          !this.state.blockedAutomatic
        ) {
          const hosts = (await this.hosts()).filter(
            (host) => host.automatic !== false,
          );
          if (hosts.length === 1) await this.connect(hosts[0].hostId);
          else if (hosts.length > 1) this.current = "selectHost";
        }
      } catch {
        this.current = "waiting";
      }
      return;
    }
    this.busy = true;
    try {
      if (this.state.pendingDisconnect) {
        await revokeBinding(
          this.directory,
          this.state.hostId,
          this.state.clientId,
          this.state.key,
        );
        await this.clearBinding();
        return;
      }
      if (
        await isRevoked(
          this.directory,
          this.state.hostId,
          this.state.clientId,
          this.state.key,
        )
      ) {
        await this.clearBinding();
        return;
      }
      const host = (await this.hosts()).find(
        (item) => item.hostId === this.state.hostId,
      );
      if (!host) {
        this.current = this.state.pendingDisconnect
          ? "pendingDisconnect"
          : "waiting";
        return;
      }
      const result = await this.post(host, "/poll");
      if (this.stopped) return;
      if (result.connected !== true) {
        await this.clearBinding();
        return;
      }
      this.current = "connected";
      await this.supplyIcon(host, result);
      if (!Array.isArray(result.requests)) return;
      for (const request of result.requests.slice(0, 32)) {
        if (
          !request ||
          typeof request.id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(request.id) ||
          typeof request.deepLink !== "string" ||
          request.deepLink.length > 24576
        )
          continue;
        if (!this.received.has(request.id)) {
          let accepted = false;
          if (parseDownloaderDeepLink(request.deepLink)) {
            try {
              this.open(request.deepLink);
              accepted = true;
            } catch {
              /* Report a rejected handoff. */
            }
          }
          this.received.set(request.id, accepted);
          if (this.received.size > 256)
            this.received.delete(this.received.keys().next().value!);
        }
        await this.post(host, "/ack", {
          id: request.id,
          accepted: this.received.get(request.id),
        });
      }
    } catch {
      this.current = this.state.pendingDisconnect
        ? "pendingDisconnect"
        : "waiting";
    } finally {
      this.busy = false;
    }
  }

  /** Supplies pixels only when the authenticated host reports a missing or changed cache entry. */
  private async supplyIcon(host: Host, reply: Reply): Promise<void> {
    if (reply.iconNeeded === true && this.icon) {
      await this.post(host, "/icon", { png: this.icon.png }).catch(() => {});
    }
  }

  /** Exchanges bounded JSON with a validated loopback record; redirects are forbidden. */
  private async post(
    host: Host,
    route: string,
    extra: object = {},
    timeout = 5000,
  ): Promise<Reply> {
    const response = await fetch(`${host.endpoint}${route}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(timeout),
      ]),
      headers: {
        Authorization: `Bearer ${host.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: APP_ID,
        clientId: this.state.clientId,
        key: this.state.key,
        iconHash: this.icon === null ? null : this.icon?.hash,
        ...extra,
      }),
    });
    if (!response.ok) throw new Error("Development connection rejected.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing connection response.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Connection response too large.");
      }
      chunks.push(value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Invalid response.");
    return result as Reply;
  }

  /** Atomically stores only connection identity, never page URLs or cookies. */
  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(this.state), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
