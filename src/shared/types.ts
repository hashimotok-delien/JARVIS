export type Role = "user" | "assistant" | "system";

export interface Thread {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: Role;
  content: string;
  createdAt: number;
  provider?: string;
  model?: string;
  error?: string;
  pending?: boolean;
}

export type HudState = "idle" | "listening" | "thinking" | "speaking";

export interface AppInfo {
  name: string;
  version: string;
}

export type ProviderId = "gemini" | "ollama";

export interface ProviderSettings {
  order: ProviderId[];
  geminiModel: string;
  geminiBaseUrl: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
}

export interface TtsSettings {
  enabled: boolean;
  engine: "edge" | "sapi";
  voice: string;
  sapiVoice: string;
  rate: number;
  volume: number;
}

export interface SttSettings {
  enabled: boolean;
  language: string;
  whisperPath: string;
  modelPath: string;
  silenceMs: number;
  threshold: number;
  handsFree: boolean;
  wakeSamples: string[];
  followUpMs: number;
}

export interface HudSettings {
  clickThrough: boolean;
  opacity: number;
  pinned: boolean;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
}

export interface Settings {
  providers: ProviderSettings;
  systemPrompt: string;
  preferredName: string;
  temperature: number;
  maxHistory: number;
  tts: TtsSettings;
  stt: SttSettings;
  hud: HudSettings;
  startMinimized: boolean;
}

export interface SettingsPayload extends Settings {
  hasGeminiKey: boolean;
  sttAvailable: boolean;
  sttDetail: string;
  dbPath: string;
  dataDir: string;
  previousVersion?: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion?: string | null;
  hasUpdate: boolean;
  notes?: string | null;
  releasedAt?: string | null;
  installerPath?: string | null;
  url?: string | null;
  updateDir?: string | null;
  manifestPath?: string | null;
  error?: string | null;
}

export interface ProviderCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface AudioPayload {
  base64: string;
  mime: string;
  engine: string;
  voice: string;
}

export interface SendAck {
  requestId: string;
  threadId: string;
  userMessage: ChatMessage;
  assistantId: string;
}

/* ---- backend events ---- */

export interface ChatDeltaEvent {
  requestId: string;
  threadId: string;
  messageId: string;
  delta: string;
}

export interface ChatDoneEvent {
  requestId: string;
  threadId: string;
  messageId: string;
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
  stopped: boolean;
}

export interface ChatErrorEvent {
  requestId: string;
  threadId: string;
  messageId: string;
  error: string;
  provider?: string;
}

export interface ChatProviderEvent {
  requestId: string;
  threadId: string;
  provider: string;
  model: string;
  reason?: string;
}

export interface ChatTitleEvent {
  threadId: string;
  title: string;
}

export interface VoiceStateEvent {
  state: HudState;
  detail?: string;
}

export interface VoiceTranscriptEvent {
  text: string;
  isFinal: boolean;
}
