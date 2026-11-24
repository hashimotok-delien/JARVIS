import { invoke } from "@tauri-apps/api/core";
import type { AudioPayload, HudState } from "../../shared/types";
import { isTauri } from "./app";

export async function transcribe(audioBase64: string): Promise<string> {
  if (!isTauri) {
    throw new Error("音声認識はデスクトップアプリでのみ利用できます");
  }
  return invoke<string>("transcribe", { audioBase64 });
}

export async function transcribeWakeSample(
  audioBase64: string,
  wakeSamples: string[],
): Promise<string> {
  if (!isTauri) {
    throw new Error("ウェイクワード登録はデスクトップアプリでのみ利用できます");
  }
  return invoke<string>("transcribe_wake_sample", {
    audioBase64,
    wakeSamples,
  });
}

export async function speak(text: string): Promise<AudioPayload> {
  if (!isTauri) {
    throw new Error("読み上げはデスクトップアプリでのみ利用できます");
  }
  return invoke<AudioPayload>("speak", { text });
}

export async function reportVoiceState(
  state: HudState,
  detail?: string | null,
): Promise<void> {
  if (!isTauri) return;
  await invoke("report_voice_state", {
    stateName: state,
    detail: detail ?? null,
  });
}
