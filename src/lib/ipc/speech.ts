import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./app";
import { logError } from "../logging";
import type { SpeechModelStatus } from "../../shared/types";

export async function speechModelStatus(): Promise<SpeechModelStatus | null> {
  if (!isTauri) return null;
  try {
    return await invoke<SpeechModelStatus>("speech_model_status");
  } catch (error) {
    void logError("speech_model_status", error);
    return null;
  }
}

export async function downloadSpeechModel(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string>("download_speech_model");
  } catch (error) {
    void logError("download_speech_model", error);
    throw error;
  }
}

export async function installSpeechBinary(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string>("install_speech_binary");
  } catch (error) {
    void logError("install_speech_binary", error);
    throw error;
  }
}
