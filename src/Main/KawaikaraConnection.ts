import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DevelopmentConnection } from "./DevelopmentConnection";
import type { DevelopmentConnectionStatus } from "../Shared/types";

type Target = { mode: "installed" } | { mode: "development"; directory?: string };

/** Selects an explicit host namespace; a missing DEV host never opens an installed host. */
export class KawaikaraConnection {
  private target: Target;
  private connection?: DevelopmentConnection;
  private changes: Promise<unknown> = Promise.resolve();
  private readonly targetFile: string;

  /**
   * @param userData Private downloader profile containing the remembered target and per-target identities.
   * @param packaged Only packaged apps default to the installed protocol handler.
   * @param create Constructs the authenticated connection for one selected directory.
   * @param wakeInstalled Explicit installed-mode wake operation; never used by DEV discovery.
   */
  constructor(
    private readonly userData: string,
    packaged: boolean,
    private readonly create: (file: string, directory: string) => DevelopmentConnection,
    private readonly wakeInstalled: () => Promise<void>,
  ) {
    this.target = { mode: packaged ? "installed" : "development" };
    this.targetFile = path.join(userData, "kawaikara-connection-target.json");
  }

  /** Restores the chosen target; an explicit command-line environment overrides remembered selection. */
  async start(directoryOverride?: string): Promise<void> {
    if (directoryOverride !== undefined) {
      this.requireDirectory(directoryOverride);
      this.target = { mode: "development", directory: path.normalize(directoryOverride) };
    } else {
      try {
        const value = JSON.parse(await readFile(this.targetFile, "utf8"));
        if (value.mode === "installed") this.target = { mode: "installed" };
        else if (value.mode === "development" && typeof value.directory === "string") {
          this.requireDirectory(value.directory);
          this.target = { mode: "development", directory: value.directory };
        } else throw new Error("Invalid Kawaikara connection target.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await this.startSelected();
  }

  /** Public target information excludes all pairing credentials and endpoint tokens. */
  status(): DevelopmentConnectionStatus {
    if (this.target.mode === "installed") return { development: false, state: "disconnected" };
    return {
      ...(this.connection?.status() ?? { development: true, state: "waiting" as const }),
      directory: this.target.directory,
      requiresDirectory: !this.target.directory,
    };
  }

  /** Validates a user-selected checkout before revoking/replacing the current connection. */
  async selectCheckout(checkout: string): Promise<DevelopmentConnectionStatus> {
    const root = await realpath(checkout);
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    if (manifest.name !== "kawaikara") throw new Error("Select the Kawaikara checkout containing package.json.");
    return this.select({ mode: "development", directory: path.join(root, "tmp", "development-connections") });
  }

  /** Switching to the installed app is always an explicit user action. */
  useInstalled(): Promise<DevelopmentConnectionStatus> { return this.select({ mode: "installed" }); }

  async connect(hostId?: string): Promise<DevelopmentConnectionStatus> {
    await this.changes;
    if (!this.connection) return this.status();
    const result = await this.connection.connect(hostId);
    return { ...result, directory: this.target.mode === "development" ? this.target.directory : undefined };
  }

  async setAutomatic(enabled: boolean): Promise<DevelopmentConnectionStatus> {
    await this.changes;
    await this.connection?.setAutomatic(enabled);
    return this.status();
  }

  async disconnect(): Promise<DevelopmentConnectionStatus> {
    await this.changes;
    await this.connection?.disconnect();
    return this.status();
  }

  /** DEV mode returns its actual handshake result; it never tries the installed URI as a fallback. */
  async open(): Promise<boolean> {
    await this.changes;
    if (this.target.mode === "development") return (await this.connect()).state === "connected";
    try { await this.wakeInstalled(); return true; } catch { return false; }
  }

  async dispose(): Promise<void> {
    await this.changes;
    await this.connection?.dispose();
  }

  private requireDirectory(directory: string): void {
    if (!path.isAbsolute(directory)) throw new Error("Kawaikara development connection directory must be absolute.");
  }

  private select(target: Target): Promise<DevelopmentConnectionStatus> {
    const change = this.changes.then(async () => {
      const unchanged = JSON.stringify(this.target) === JSON.stringify(target);
      if (!unchanged) {
        await this.connection?.disconnect(); // Durable revocation also works when the old host is offline.
        await this.connection?.dispose();
        this.connection = undefined;
        this.target = target;
      }
      await mkdir(this.userData, { recursive: true });
      const temporary = `${this.targetFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(target), { mode: 0o600, flag: "wx" });
        await rename(temporary, this.targetFile);
      } finally { await rm(temporary, { force: true }); }
      if (!this.connection) await this.startSelected();
      return this.status();
    });
    this.changes = change.catch(() => undefined);
    return change;
  }

  private async startSelected(): Promise<void> {
    if (this.target.mode !== "development" || !this.target.directory) return;
    // Different checkouts must not reuse a host ID, grant state or pending revocation.
    const identity = createHash("sha256").update(this.target.directory).digest("hex");
    const connection = this.create(path.join(this.userData, `kawaikara-development-${identity}.json`), this.target.directory);
    this.connection = connection;
    try { await connection.start(); }
    catch (error) { await connection.dispose(); this.connection = undefined; throw error; }
  }
}
