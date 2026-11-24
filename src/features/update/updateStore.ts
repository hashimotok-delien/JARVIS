import { useSyncExternalStore } from "react";
import { checkUpdate } from "../../lib/ipc/update";
import type { UpdateStatus } from "../../shared/types";

type Listener = () => void;

class UpdateStore {
  private snapshot: UpdateStatus | null = null;
  private listeners = new Set<Listener>();
  private inflight = false;

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
}

export const updateStore = new UpdateStore();

export function useUpdate(): UpdateStatus | null {
  return useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot,
  );
}
