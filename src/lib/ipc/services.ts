import { invoke } from "@tauri-apps/api/core";
import type { LocalService, ServiceStatus } from "../../shared/types";
import { isTauri } from "./app";

export async function listLocalServices(): Promise<ServiceStatus[]> {
  if (!isTauri) return [];
  try {
    return await invoke<ServiceStatus[]>("list_local_services");
  } catch {
    return [];
  }
}

export async function startLocalService(
  service: LocalService,
): Promise<string> {
  return invoke<string>("start_local_service", { service });
}

export async function stopLocalService(name: string): Promise<boolean> {
  return invoke<boolean>("stop_local_service", { name });
}

export async function startAllLocalServices(): Promise<number> {
  return invoke<number>("start_all_local_services");
}

export async function stopAllLocalServices(): Promise<number> {
  return invoke<number>("stop_all_local_services");
}
