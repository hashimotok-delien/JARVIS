import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "./app";
import { logError } from "../logging";

/** Subscribe to a backend event; a no-op unlisten is returned outside Tauri. */
export async function onEvent<T>(
  name: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri) {
    return () => undefined;
  }
  return listen<T>(name, (event) => handler(event.payload));
}

export async function publishVoiceTranscript(
  text: string,
  isFinal: boolean,
): Promise<void> {
  if (!isTauri) return;
  try {
    await emit(VOICE_TRANSCRIPT, { text, isFinal });
  } catch (error) {
    void logError("publish_voice_transcript", error);
  }
}

export const CHAT_DELTA = "chat://delta";
export const CHAT_DONE = "chat://done";
export const CHAT_ERROR = "chat://error";
export const CHAT_PROVIDER = "chat://provider";
export const CHAT_TITLE = "chat://title";
export const VOICE_STATE = "voice://state";
export const VOICE_TOGGLE = "voice://toggle";
export const VOICE_TRANSCRIPT = "voice://transcript";
export const SETTINGS_CHANGED = "settings://changed";
