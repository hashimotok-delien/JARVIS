import { useSyncExternalStore } from "react";
import { checkUpdate } from "../../lib/ipc/update";
import { settingsStore } from "../settings/settingsStore";
import type { UpdateStatus } from "../../shared/types";

type Listener = () => void;

class UpdateStore {
  private snapshot: UpdateStatus | null = null;
  private listeners = new Set<Listener>();
  private inflight = false;
  private watcher: number | null = null;
  private watching = false;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UpdateStatus | null => this.snapshot;

  private set(next: UpdateStatus | null) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  async refresh(): Promise<UpdateStatus | null> {
    if (this.inflight) return this.snapshot;
    this.inflight = true;
    try {
      const status = await checkUpdate();
      this.set(status);
      return status;
    } finally {
      this.inflight = false;
    }
  }

  /** Poll the configured update folder so a new build is noticed while running. */
  startWatching() {
    if (this.watching) return;
    this.watching = true;
    settingsStore.subscribe(() => this.schedule());
    this.schedule();
  }

  private schedule() {
    this.clearWatcher();
    const settings = settingsStore.get();
    if (!settings?.updates.watch) return;
    const seconds = Math.max(15, settings.updates.pollSeconds || 60);
    this.watcher = window.setTimeout(() => {
      this.watcher = null;
      void this.refresh().finally(() => this.schedule());
    }, seconds * 1000);
  }

  private clearWatcher() {
    if (this.watcher !== null) {
      window.clearTimeout(this.watcher);
      this.watcher = null;
    }
  }
}

export const updateStore = new UpdateStore();

export function useUpdate(): UpdateStatus | null {
  return useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot,
  );
}
