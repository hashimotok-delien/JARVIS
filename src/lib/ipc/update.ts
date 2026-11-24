import { invoke } from "@tauri-apps/api/core";
import type { UpdateStatus } from "../../shared/types";
import { isTauri } from "./app";

export async function checkUpdate(): Promise<UpdateStatus | null> {
  if (!isTauri) return null;
  try {
    return await invoke<UpdateStatus>("check_update");
  } catch (error) {
    console.error("check_update failed", error);
    return null;
  }
}

export async function launchUpdateInstaller(): Promise<void> {
  if (!isTauri) return;
  await invoke("launch_update_installer");
}

export async function openUpdateDir(): Promise<void> {
  if (!isTauri) return;
  await invoke("open_update_dir");
}
