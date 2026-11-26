import { invoke } from "@tauri-apps/api/core";
import type {
  ProviderCheck,
  Settings,
  SettingsPayload,
} from "../../shared/types";
import { isTauri } from "./app";

export const DEFAULT_SETTINGS: SettingsPayload = {
  providers: {
    order: ["gemini", "ollama", "opencode"],
    geminiModel: "gemini-2.5-flash",
    geminiBaseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai",
    ollamaModel: "qwen2.5:7b-instruct",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    opencodeBaseUrl: "http://127.0.0.1:3000/v1",
    opencodeModel: "deepseek-v4.1-flash",
    opencodeHeavyModel: "deepseek-v4.1-pro",
    autoRoute: false,
  },
  systemPrompt: "",
  preferredName: "ボス",
  temperature: 0.7,
  maxHistory: 24,
  tts: {
    enabled: true,
    engine: "edge",
    voice: "ja-JP-NanamiNeural",
    sapiVoice: "",
    rate: 0,
    volume: 100,
    pitch: 0,
    bargeIn: true,
  },
  stt: {
    enabled: true,
    engine: "speech",
    language: "ja",
    speechPath: "",
    speechModel: "haas-ja-v1.0",
    speechDevice: "auto",
    inputDeviceId: "",
    speechKeywords: true,
    whisperPath: "",
    modelPath: "",
    whisperPrompt: "",
    silenceMs: 800,
    threshold: 0.02,
    handsFree: false,
    wakeSamples: [],
    followUpMs: 12000,
    wakeWatch: false,
    denoise: true,
    denoiseEngine: "rnnoise",
    normalize: true,
  },
  hud: {
    clickThrough: false,
    opacity: 1,
    pinned: false,
    width: 380,
    height: 208,
    positionX: 40,
    positionY: 40,
    staticMode: false,
    showClock: true,
    showSystem: true,
    showWeather: true,
    showUsage: true,
    weatherCity: "TOKYO",
    weatherLat: 35.6812,
    weatherLon: 139.7671,
  },
  startMinimized: false,
  tools: {
    enabled: true,
    webSearch: true,
    shell: true,
    files: true,
    clipboard: true,
    screenshot: true,
    timers: true,
    approval: true,
    mcpServers: [],
  },
  memory: {
    enabled: true,
    autoExtract: false,
    inject: true,
    maxItems: 12,
    autoSummarize: true,
  },
  ui: {
    theme: "dark",
    fontScale: 1,
    hudPreset: "custom",
    clipboardWatch: false,
    hudTheme: "arc",
    hudAccent: "#00e5ff",
  },
  services: [],
  updates: {
    folder: "",
    watch: true,
    pollSeconds: 60,
  },
  hasGeminiKey: false,
  hasOpencodeKey: false,
  sttAvailable: false,
  sttDetail: "バックエンド未接続",
  dbPath: "",
  dataDir: "",
  previousVersion: null,
};

export async function getSettings(): Promise<SettingsPayload> {
  if (!isTauri) return DEFAULT_SETTINGS;
  return invoke<SettingsPayload>("get_settings");
}

export async function saveSettings(
  settings: Settings,
): Promise<SettingsPayload> {
  if (!isTauri) return { ...DEFAULT_SETTINGS, ...settings };
  return invoke<SettingsPayload>("save_settings", { settings });
}

export async function setGeminiKey(
  key: string | null,
): Promise<SettingsPayload> {
  if (!isTauri) return DEFAULT_SETTINGS;
  return invoke<SettingsPayload>("set_gemini_key", { key });
}

export async function setOpencodeKey(
  key: string | null,
): Promise<SettingsPayload> {
  if (!isTauri) return DEFAULT_SETTINGS;
  return invoke<SettingsPayload>("set_opencode_key", { key });
}

export async function testProviders(): Promise<ProviderCheck[]> {
  if (!isTauri) return [];
  return invoke<ProviderCheck[]>("test_providers");
}

export async function toggleMute(): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("toggle_mute");
}
