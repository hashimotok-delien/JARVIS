import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./app";
import { logError } from "../logging";

export interface FilePickerOptions {
  title?: string;
  /** Windows filter syntax: `説明 (*.exe)|*.exe|すべてのファイル (*.*)|*.*` */
  filter?: string;
  initialDir?: string;
}

async function pick<T extends Record<string, unknown>>(
  command: string,
  args: T,
): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>(command, args);
  } catch (error) {
    void logError(command, error);
    return null;
  }
}

export function pickFile(options: FilePickerOptions = {}): Promise<string | null> {
  return pick("pick_file", {
    title: options.title ?? null,
    filter: options.filter ?? null,
    initialDir: options.initialDir ?? null,
  });
}

export function pickFolder(
  options: { title?: string; initialDir?: string } = {},
): Promise<string | null> {
  return pick("pick_folder", {
    title: options.title ?? null,
    initialDir: options.initialDir ?? null,
  });
}
