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

export async function requestVoiceToggle(): Promise<void> {
  if (!isTauri) return;
  await invoke("request_voice_toggle");
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_main_window");
}
