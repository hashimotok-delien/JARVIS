import { invoke } from "@tauri-apps/api/core";
import type {
  CapturedImage,
  HudGeometry,
  Memory,
  SearchHit,
  SystemStats,
  Template,
  Thread,
  UsageStats,
} from "../../shared/types";
import { isTauri } from "./app";

export async function searchMessages(
  query: string,
  limit = 40,
): Promise<SearchHit[]> {
  if (!isTauri) return [];
  return invoke<SearchHit[]>("search_messages", { query, limit });
}

export async function truncateFromMessage(
  threadId: string,
  messageId: string,
): Promise<void> {
  if (!isTauri) return;
  await invoke("truncate_from_message", { threadId, messageId });
}

export async function branchThread(
  threadId: string,
  messageId: string,
): Promise<Thread | null> {
  if (!isTauri) return null;
  return invoke<Thread>("branch_thread", { threadId, messageId });
}

export async function usageStats(): Promise<UsageStats | null> {
  if (!isTauri) return null;
  try {
    return await invoke<UsageStats>("usage_stats");
  } catch {
    return null;
  }
}

export async function systemStats(): Promise<SystemStats | null> {
  if (!isTauri) return null;
  try {
    return await invoke<SystemStats>("system_stats");
  } catch {
    return null;
  }
}

/* ---- memory ---- */

export async function listMemories(limit = 200): Promise<Memory[]> {
  if (!isTauri) return [];
  return invoke<Memory[]>("list_memories", { limit });
}

export async function addMemory(
  content: string,
  kind = "fact",
): Promise<Memory> {
  return invoke<Memory>("add_memory", { content, kind });
}

export async function updateMemory(
  id: string,
  content: string,
  kind = "fact",
): Promise<void> {
  await invoke("update_memory", { id, content, kind });
}

export async function deleteMemory(id: string): Promise<void> {
  await invoke("delete_memory", { id });
}

export async function summarizeThread(threadId: string): Promise<string> {
  return invoke<string>("summarize_thread", { threadId });
}

export async function dailyDigest(): Promise<string> {
  return invoke<string>("daily_digest");
}

/* ---- templates ---- */

export async function listTemplates(): Promise<Template[]> {
  if (!isTauri) return [];
  return invoke<Template[]>("list_templates");
}

export async function addTemplate(
  name: string,
  body: string,
): Promise<Template> {
  return invoke<Template>("add_template", { name, body });
}

export async function deleteTemplate(id: string): Promise<void> {
  await invoke("delete_template", { id });
}

/* ---- data ---- */

export async function exportAll(
  format: "markdown" | "json",
): Promise<string> {
  return invoke<string>("export_all", { format });
}

export async function backupDatabase(): Promise<string> {
  return invoke<string>("backup_database");
}

/* ---- desktop tools ---- */

export async function readClipboardText(): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_clipboard_text");
}

export async function writeClipboardText(text: string): Promise<void> {
  if (!isTauri) return;
  await invoke("write_clipboard_text", { text });
}

export async function getHudGeometry(): Promise<HudGeometry | null> {
  if (!isTauri) return null;
  try {
    return await invoke<HudGeometry>("get_hud_geometry");
  } catch {
    return null;
  }
}

export async function captureScreenImage(): Promise<CapturedImage | null> {
  if (!isTauri) return null;
  return invoke<CapturedImage>("capture_screen_image");
}

export async function resolveToolApproval(
  id: string,
  approved: boolean,
): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("resolve_tool_approval", { id, approved });
}

export async function notifyDesktop(
  title: string,
  body: string,
): Promise<void> {
  if (!isTauri) return;
  await invoke("notify_desktop", { title, body });
}

export async function setTimerNow(
  minutes: number,
  label?: string,
): Promise<void> {
  if (!isTauri) return;
  await invoke("set_timer_now", { minutes, label: label ?? null });
}

export async function captureSelection(): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("capture_selection");
}

export async function transcribeAudioFile(
  audioBase64: string,
): Promise<string> {
  return invoke<string>("transcribe_audio_file", { audioBase64 });
}

export async function showQuickPalette(prompt?: string): Promise<void> {
  if (!isTauri) return;
  if (prompt) {
    await invoke("show_quick_window", { prompt });
  } else {
    await invoke("show_quick_palette");
  }
}

export async function toggleQuick(): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("toggle_quick");
}
