import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../../shared/types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getAppInfo(): Promise<AppInfo | null> {
  if (!isTauri) {
    return { name: "J.A.R.V.I.S.", version: "dev" };
  }
  try {
    return await invoke<AppInfo>("app_info");
  } catch (error) {
    console.error("app_info failed", error);
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
    console.error("toggle_hud failed", error);
    return false;
  }
}

export async function setHudVisible(visible: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_hud_visible", { visible });
}

export async function requestVoiceToggle(): Promise<void> {
  if (!isTauri) return;
  await invoke("request_voice_toggle");
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_main_window");
}
