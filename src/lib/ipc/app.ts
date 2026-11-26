import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../../shared/types";
import { logError } from "../logging";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getAppInfo(): Promise<AppInfo | null> {
  if (!isTauri) {
    return { name: "J.A.R.V.I.S.", version: "dev" };
  }
  try {
    return await invoke<AppInfo>("app_info");
  } catch (error) {
    void logError("app_info", error);
    return null;
  }
}

export async function toggleHud(): Promise<boolean> {
  if (!isTauri) {
    return false;
  }
  try {
    return await invoke<boolean>("toggle_hud");
  } catch (error) {
    void logError("toggle_hud", error);
    return false;
  }
}

export async function setHudVisible(visible: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_hud_visible", { visible });
}

export async function setHudPriority(foreground: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("set_hud_priority", { foreground });
  } catch (error) {
    void logError("set_hud_priority", error);
  }
}

/** Persist the HUD geometry after the user drags or resizes it. */
export async function saveHudGeometry(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("save_hud_geometry", { x, y, width, height });
  } catch (error) {
    void logError("save_hud_geometry", error);
  }
}

/** Pin the HUD at its current spot (and freeze its size). */
export async function setHudPinned(pinned: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_hud_pinned", { pinned });
}

export async function requestVoiceToggle(): Promise<void> {
  if (!isTauri) return;
  await invoke("request_voice_toggle");
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_main_window");
}

/** Show the main window if hidden/minimized, otherwise hide it. */
export async function toggleMainWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("toggle_main_window");
  } catch (error) {
    void logError("toggle_main_window", error);
  }
}
