export type Role = "user" | "assistant" | "system";

export interface Thread {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  summary?: string | null;
  summaryUpto?: number;
}

export interface Memory {
  id: string;
  content: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
}

export interface Template {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

export interface SearchHit {
  messageId: string;
  threadId: string;
  threadTitle: string;
  role: Role;
  snippet: string;
  createdAt: number;
}

export interface UsageBucket {
  requests: number;
  characters: number;
  avgLatencyMs: number;
}

export interface ProviderUsage {
  provider: string;
  model: string;
  requests: number;
  characters: number;
  avgLatencyMs: number;
}

export interface UsageStats {
  today: UsageBucket;
  week: UsageBucket;
  all: UsageBucket;
  byProvider: ProviderUsage[];
}

export interface CapturedImage {
  base64: string;
  path: string;
}

export interface HudGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
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
  autoRoute: boolean;
}

export interface TtsSettings {
  enabled: boolean;
  engine: "edge" | "sapi";
  voice: string;
  sapiVoice: string;
  rate: number;
  volume: number;
  pitch: number;
  bargeIn: boolean;
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
  wakeWatch: boolean;
}

export interface McpServer {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export interface ToolSettings {
  enabled: boolean;
  webSearch: boolean;
  shell: boolean;
  files: boolean;
  clipboard: boolean;
  screenshot: boolean;
  timers: boolean;
  approval: boolean;
  mcpServers: McpServer[];
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  inject: boolean;
  maxItems: number;
  autoSummarize: boolean;
}

export interface UiSettings {
  theme: "dark" | "light";
  fontScale: number;
  hudPreset: string;
  clipboardWatch: boolean;
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
  tools: ToolSettings;
  memory: MemorySettings;
  ui: UiSettings;
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

export interface ToolApprovalEvent {
  id: string;
  tool: string;
  summary: string;
}

export interface ToolStatusEvent {
  name: string;
  state: "running" | "ok" | "error" | "denied";
  detail?: string | null;
}

export interface TimerFiredEvent {
  label: string;
  seconds: number;
}

export interface QuickPromptEvent {
  text: string;
}
