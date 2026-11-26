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

export type ProviderId = "gemini" | "ollama" | "opencode";

export interface ProviderSettings {
  order: ProviderId[];
  geminiModel: string;
  geminiBaseUrl: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
  opencodeBaseUrl: string;
  opencodeModel: string;
  opencodeHeavyModel: string;
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
  engine: "speech" | "whisper";
  language: string;
  speechPath: string;
  speechModel: string;
  speechDevice: "auto" | "gpu" | "cpu";
  inputDeviceId: string;
  speechKeywords: boolean;
  whisperPath: string;
  modelPath: string;
  whisperPrompt: string;
  silenceMs: number;
  threshold: number;
  handsFree: boolean;
  wakeSamples: string[];
  followUpMs: number;
  wakeWatch: boolean;
  denoise: boolean;
  denoiseEngine: "rnnoise" | "classic";
  normalize: boolean;
}

export interface SpeechModelStatus {
  path: string;
  present: boolean;
  bytes: number;
  expectedBytes: number;
  url: string;
}

export interface SpeechModelProgressEvent {
  received: number;
  total: number;
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
  /** "arc" | "ember" | "matrix" | "crimson" | "mono" | "custom". */
  hudTheme: string;
  /** Accent colour (#rrggbb) used when `hudTheme` is "custom". */
  hudAccent: string;
}

export interface UpdateSettings {
  folder: string;
  watch: boolean;
  pollSeconds: number;
}

export interface LocalService {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  healthUrl: string;
  autoStart: boolean;
  stopOnExit: boolean;
  enabled: boolean;
}

export interface ServiceStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  owned: boolean;
  detail: string;
}

export interface HudSettings {
  clickThrough: boolean;
  opacity: number;
  pinned: boolean;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  /** Freeze ring rotation and drop the blur to save CPU. */
  staticMode: boolean;
  showClock: boolean;
  showSystem: boolean;
  showWeather: boolean;
  showUsage: boolean;
  weatherCity: string;
  weatherLat: number;
  weatherLon: number;
}

export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptimeSecs: number;
}

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
}

export interface WeatherReport {
  city: string;
  temp: number;
  code: number;
  description: string;
  days: WeatherDay[];
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
  updates: UpdateSettings;
  services: LocalService[];
}

export interface SettingsPayload extends Settings {
  hasGeminiKey: boolean;
  hasOpencodeKey: boolean;
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

export interface VoiceSpectrumEvent {
  values: number[];
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
