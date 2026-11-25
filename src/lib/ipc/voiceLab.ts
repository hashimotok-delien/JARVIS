import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./app";

export interface VoiceTestResult {
  engine: string;
  model: string;
  text: string;
  cer: number;
  elapsedMs: number;
  createdAt: number;
  error: string | null;
}

export interface VoiceTest {
  id: string;
  name: string;
  reference: string;
  createdAt: number;
  durationMs: number;
  sampleRate: number;
  results: VoiceTestResult[];
}

export interface WhisperModelInfo {
  path: string;
  name: string;
  sizeMb: number;
}

export async function saveVoiceTest(
  name: string,
  reference: string,
  audioBase64: string,
): Promise<VoiceTest> {
  return invoke<VoiceTest>("save_voice_test", {
    name,
    reference,
    audioBase64,
  });
}

export async function listVoiceTests(): Promise<VoiceTest[]> {
  if (!isTauri) return [];
  return invoke<VoiceTest[]>("list_voice_tests");
}

export async function readVoiceTestAudio(id: string): Promise<string> {
  return invoke<string>("read_voice_test_audio", { id });
}

export async function deleteVoiceTest(id: string): Promise<void> {
  await invoke("delete_voice_test", { id });
}

export async function runVoiceTest(
  id: string,
  engine?: "speech" | "whisper",
  modelPath?: string,
): Promise<VoiceTestResult> {
  return invoke<VoiceTestResult>("run_voice_test", {
    id,
    engine: engine ?? null,
    modelPath: modelPath ?? null,
  });
}

export async function listWhisperModels(): Promise<WhisperModelInfo[]> {
  if (!isTauri) return [];
  return invoke<WhisperModelInfo[]>("list_whisper_models");
}
