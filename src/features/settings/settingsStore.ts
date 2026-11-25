import { useSyncExternalStore } from "react";
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  setGeminiKey,
  setOpencodeKey,
  testProviders,
} from "../../lib/ipc/settings";
import { SETTINGS_CHANGED, onEvent } from "../../lib/ipc/events";
import { logError } from "../../lib/logging";
import type {
  ProviderCheck,
  Settings,
  SettingsPayload,
} from "../../shared/types";

type Listener = () => void;

class SettingsStore {
  private snapshot: SettingsPayload | null = null;
  private listeners = new Set<Listener>();
  private initialized = false;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SettingsPayload | null => this.snapshot;

  get(): SettingsPayload | null {
    return this.snapshot;
  }

  private set(next: SettingsPayload) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      this.set(await getSettings());
    } catch (error) {
      void logError("get_settings", error);
      this.set(DEFAULT_SETTINGS);
    }

    await onEvent<Settings>(SETTINGS_CHANGED, (payload) => {
      this.set({
        ...(this.snapshot ?? DEFAULT_SETTINGS),
        ...payload,
      });
    });
  }

  async save(settings: Settings): Promise<SettingsPayload> {
    const payload = await saveSettings(settings);
    this.set(payload);
    return payload;
  }

  async updateKey(key: string | null): Promise<SettingsPayload> {
    const payload = await setGeminiKey(key);
    this.set(payload);
    return payload;
  }

  async updateOpencodeKey(key: string | null): Promise<SettingsPayload> {
    const payload = await setOpencodeKey(key);
    this.set(payload);
    return payload;
  }

  async test(): Promise<ProviderCheck[]> {
    return testProviders();
  }
}

export const settingsStore = new SettingsStore();

export function useSettings(): SettingsPayload | null {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
  );
}
