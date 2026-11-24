import { invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  SendAck,
  Thread,
} from "../../shared/types";
import { isTauri } from "./app";

export async function listThreads(): Promise<Thread[]> {
  if (!isTauri) return [];
  return invoke<Thread[]>("list_threads");
}

export async function createThread(title?: string): Promise<Thread | null> {
  if (!isTauri) return null;
  return invoke<Thread>("create_thread", { title: title ?? null });
}

export async function renameThread(id: string, title: string): Promise<void> {
  if (!isTauri) return;
  await invoke("rename_thread", { id, title });
}

export async function deleteThread(id: string): Promise<void> {
  if (!isTauri) return;
  await invoke("delete_thread", { id });
}

export async function setThreadPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  if (!isTauri) return;
  await invoke("set_thread_pinned", { id, pinned });
}

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  if (!isTauri) return [];
  return invoke<ChatMessage[]>("list_messages", { threadId });
}

export async function sendMessage(
  threadId: string,
  content: string,
  imageBase64?: string | null,
  source?: "voice" | "quick" | null,
): Promise<SendAck | null> {
  if (!isTauri) return null;
  return invoke<SendAck>("send_message", {
    threadId,
    content,
    imageBase64: imageBase64 ?? null,
    source: source ?? null,
  });
}

export async function stopGeneration(requestId: string): Promise<void> {
  if (!isTauri) return;
  await invoke("stop_generation", { requestId });
}

export async function exportThread(
  id: string,
  format: "markdown" | "json",
): Promise<string> {
  return invoke<string>("export_thread", { id, format });
}
