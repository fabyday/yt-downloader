import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { normalizeLocale } from "../../Shared/locale";
import {
  createDefaultAppPreferences,
  normalizeAppPreferences,
} from "../../Shared/preferences";
import type { AppPreferences } from "../../Shared/types";
import { BaseManager } from "./BaseManager";
import { PreferenceReturnType } from "./ReturnTypes";

export class PreferenceManager extends BaseManager<PreferenceReturnType> {
  private preferences = createDefaultAppPreferences("ko", "");
  private preferencePath: string | null = null;

  async initialize(): Promise<ReturnCode<PreferenceReturnType>> {
    try {
      const directory = app.getPath("userData");
      await fs.mkdir(directory, { recursive: true });
      this.preferencePath = path.join(directory, "preferences.json");
      this.preferences = createDefaultAppPreferences(
        normalizeLocale(app.getLocale()),
        app.getPath("downloads"),
      );
      try {
        const stored = JSON.parse(
          await fs.readFile(this.preferencePath, "utf8"),
        ) as Partial<AppPreferences>;
        this.preferences = normalizeAppPreferences(stored, this.preferences);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await this.persist();
      }
      return successReturnCode(
        PreferenceReturnType.Initialized,
        "Preference manager initialized",
      );
    } catch (error) {
      return failureReturnCode(
        PreferenceReturnType.InitializationFailed,
        "Preference manager initialization failed",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<PreferenceReturnType>> {
    try {
      await this.persist();
      return successReturnCode(
        PreferenceReturnType.Finalized,
        "Preference manager finalized",
      );
    } catch (error) {
      return failureReturnCode(
        PreferenceReturnType.FinalizationFailed,
        "Preference manager finalization failed",
        getErrorMessage(error),
      );
    }
  }

  getPreferences(): AppPreferences {
    return { ...this.preferences };
  }

  async updatePreferences(
    updates: Partial<AppPreferences>,
  ): Promise<AppPreferences> {
    this.preferences = normalizeAppPreferences(
      { ...this.preferences, ...updates },
      this.preferences,
    );
    await this.persist();
    return this.getPreferences();
  }

  private async persist(): Promise<void> {
    if (!this.preferencePath) return;
    await fs.writeFile(
      this.preferencePath,
      JSON.stringify(this.preferences, null, 2),
      "utf8",
    );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
