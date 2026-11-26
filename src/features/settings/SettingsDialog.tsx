import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpCircle,
  Check,
  Database,
  Download,
  FolderOpen,
  Plus,
  PlugZap,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import LocalServicesSettings from "./LocalServicesSettings";
import VoiceLabDialog from "../voice/VoiceLabDialog";
import { settingsStore, useSettings } from "./settingsStore";
import { updateStore, useUpdate } from "../update/updateStore";
import {
  launchUpdateInstaller,
  openUpdateDir,
} from "../../lib/ipc/update";
import {
  backupDatabase,
  exportAll,
  getHudGeometry,
} from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";
import { pickFile, pickFolder } from "../../lib/ipc/dialog";
import { downloadSpeechModel, installSpeechBinary, speechModelStatus } from "../../lib/ipc/speech";
import { SPEECH_MODEL_PROGRESS, onEvent } from "../../lib/ipc/events";
import { MicRecorder } from "../voice/recorder";
import { voiceEngine } from "../voice/voiceEngine";
import WakeEnrollDialog from "../voice/WakeEnrollDialog";
import {
  DEFAULT_ACCENT,
  HUD_THEMES,
  isHexColor,
} from "../../shared/theme/palette";
import type {
  ProviderCheck,
  ProviderId,
  Settings,
  SpeechModelProgressEvent,
  SpeechModelStatus,
} from "../../shared/types";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Gemini（クラウド・無料枠）",
  ollama: "Ollama（ローカル）",
  opencode: "OpenCode Go（サーバー）",
};

const ALL_PROVIDERS: ProviderId[] = ["opencode", "gemini", "ollama"];

const INPUT_CLASS =
  "w-[220px] rounded-md border border-[var(--border-subtle)] " +
  "bg-[var(--bg-elevated)] px-2 py-1 text-[11px] " +
  "text-[var(--text-primary)] outline-none transition " +
  "focus:border-[var(--accent-dim)] select-text";

function toDraft(source: Settings): Settings {
  return {
    providers: {
      order: [...source.providers.order] as ProviderId[],
      geminiModel: source.providers.geminiModel,
      geminiBaseUrl: source.providers.geminiBaseUrl,
      ollamaModel: source.providers.ollamaModel,
      ollamaBaseUrl: source.providers.ollamaBaseUrl,
      opencodeBaseUrl: source.providers.opencodeBaseUrl,
      opencodeModel: source.providers.opencodeModel,
      opencodeHeavyModel: source.providers.opencodeHeavyModel,
      autoRoute: source.providers.autoRoute,
    },
    systemPrompt: source.systemPrompt,
    preferredName: source.preferredName,
    temperature: source.temperature,
    maxHistory: source.maxHistory,
    tts: { ...source.tts },
    stt: { ...source.stt },
    hud: { ...source.hud },
    startMinimized: source.startMinimized,
    tools: {
      ...source.tools,
      mcpServers: source.tools.mcpServers.map((server) => ({
        ...server,
        args: [...server.args],
      })),
    },
    memory: { ...source.memory },
    ui: { ...source.ui },
    updates: { ...source.updates },
    services: source.services.map((service) => ({
      ...service,
      args: [...service.args],
    })),
  };
}

const EDGE_VOICES = [
  ["ja-JP-NanamiNeural", "Nanami（女性・標準）"],
  ["ja-JP-KeitaNeural", "Keita（男性・標準）"],
  ["ja-JP-AoiNeural", "Aoi（女性・落ち着き）"],
  ["ja-JP-MayuNeural", "Mayu（女性・明るい）"],
  ["ja-JP-DaichiNeural", "Daichi（男性・低め）"],
  ["ja-JP-NaokiNeural", "Naoki（男性・若め）"],
];

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11px] text-[var(--text-secondary)]">
        {label}
        {hint && (
          <span className="ml-1 text-[10px] text-[var(--text-muted)]">
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition ${
        checked
          ? "border-[var(--accent-dim)] bg-[var(--accent-dim)]"
          : "border-[var(--border-strong)] bg-[var(--bg-hover)]"
      }`}
    >
      <span
        className={`block h-3.5 w-3.5 rounded-full transition ${
          checked
            ? "translate-x-[18px] bg-[var(--accent)]"
            : "translate-x-[3px] bg-[var(--text-muted)]"
        }`}
      />
    </button>
  );
}

const SETTINGS_SECTIONS = [
  { id: "providers", label: "接続 / プロバイダ" },
  { id: "conversation", label: "会話" },
  { id: "tts", label: "音声出力" },
  { id: "stt", label: "音声入力" },
  { id: "tools", label: "ツール実行" },
  { id: "services", label: "ローカルサービス" },
  { id: "memory", label: "長期記憶" },
  { id: "display", label: "表示 / 通知" },
  { id: "data", label: "データ" },
  { id: "window", label: "ウィンドウ" },
  { id: "update", label: "アップデート" },
];

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3"
    >
      <h4 className="mb-1 text-[10px] tracking-[0.22em] text-[var(--text-muted)]">
        {title}
      </h4>
      {children}
    </section>
  );
}


function PathRow({
  label,
  hint,
  value,
  placeholder,
  title,
  mode,
  filter,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  title: string;
  mode: "file" | "folder";
  filter?: string;
  onChange: (path: string) => void;
}) {
  const browse = async () => {
    const current = value.trim();
    let initialDir: string | undefined = current || undefined;
    if (mode === "file" && current) {
      const cut = Math.max(
        current.lastIndexOf("\\"),
        current.lastIndexOf("/"),
      );
      initialDir = cut > 0 ? current.slice(0, cut) : undefined;
    }
    const picked =
      mode === "folder"
        ? await pickFolder({ title, initialDir })
        : await pickFile({ title, filter, initialDir });
    if (picked) onChange(picked);
  };

  return (
    <Row label={label} hint={hint}>
      <span className="flex items-center gap-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          title={value}
          className={`${INPUT_CLASS} w-[170px]`}
        />
        <button
          type="button"
          onClick={() => void browse()}
          title={title}
          className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
        >
          <FolderOpen size={10} /> 参照
        </button>
      </span>
    </Row>
  );
}

async function measureNoiseFloor(inputDeviceId?: string): Promise<number[]> {
  const recorder = new MicRecorder();
  try {
    await recorder.start(inputDeviceId);
    const levels: number[] = [];
    await new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const timer = window.setInterval(() => {
        levels.push(recorder.level());
        if (performance.now() - startedAt >= 2500) {
          window.clearInterval(timer);
          recorder.cancel();
          resolve();
        }
      }, 50);
    });
    return levels;
  } catch (error) {
    recorder.cancel();
    throw error;
  }
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  onClose,
}: SettingsDialogProps) {
  const settings = useSettings();
  const update = useUpdate();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [opencodeKey, setOpencodeKey] = useState("");
  const [activeSection, setActiveSection] = useState("providers");
  const [voiceLabOpen, setVoiceLabOpen] = useState(false);

  const jumpToSection = (id: string) => {
    setActiveSection(id);
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [checks, setChecks] = useState<ProviderCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [calibratingThreshold, setCalibratingThreshold] = useState(false);
  const [modelStatus, setModelStatus] = useState<SpeechModelStatus | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const draftRef = useRef<Settings | null>(null);

  const loadInputDevices = async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let inputs = devices.filter((device) => device.kind === "audioinput");
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        inputs = devices.filter((device) => device.kind === "audioinput");
      }
      setInputDevices(inputs);
    } catch (error) {
      void logError("enumerate_input_devices", error);
    }
  };

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    void speechModelStatus().then(setModelStatus);
    void loadInputDevices();
    let unlisten: (() => void) | undefined;
    void onEvent<SpeechModelProgressEvent>(SPEECH_MODEL_PROGRESS, (value) => {
      setDownloadProgress(value.total > 0 ? value.received / value.total : 0);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const current = settingsStore.get();
    if (current) {
      setDraft(toDraft(current));
      setApiKey("");
      setOpencodeKey("");
      setChecks(null);
      setMessage(null);
    }
    void updateStore.refresh();
  }, [open]);

  if (!open || !draft) return null;

  const patch = (changes: Partial<Settings>) =>
    setDraft((current) => (current ? { ...current, ...changes } : current));

  const save = async () => {
    const preferredName = draft.preferredName.trim();
    if (!preferredName) {
      setMessage("呼び名を入力してください");
      return;
    }

    setBusy(true);
    try {
      await settingsStore.save({ ...draft, preferredName });
      setMessage("保存しました");
    } catch (error) {
      void logError("save_settings", error);
      setMessage(`保存に失敗しました: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    try {
      await settingsStore.updateKey(apiKey.trim() ? apiKey : null);
      setApiKey("");
      setMessage(
        apiKey.trim() ? "API キーを保存しました" : "API キーを削除しました",
      );
    } catch (error) {
      void logError("save_gemini_key", error);
      setMessage(`API キーの保存に失敗: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveOpencodeKey = async () => {
    setBusy(true);
    try {
      await settingsStore.updateOpencodeKey(
        opencodeKey.trim() ? opencodeKey : null,
      );
      setOpencodeKey("");
      setMessage(
        opencodeKey.trim()
          ? "OpenCode API キーを保存しました"
          : "OpenCode API キーを削除しました",
      );
    } catch (error) {
      void logError("save_opencode_key", error);
      setMessage(`API キーの保存に失敗: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setChecks(null);
    try {
      setChecks(await settingsStore.test());
    } catch (error) {
      void logError("test_providers", error);
      setMessage(`接続テストに失敗: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const startWakeEnrollment = () => {
    if (!settings?.sttAvailable) {
      setMessage("whisper.cpp とモデルを設定してから登録してください");
      return;
    }
    if (!voiceEngine.pauseForEnrollment()) {
      setMessage("音声処理が終わってから登録してください");
      return;
    }
    setBusy(true);
    setMessage(null);
    const cleared: Settings = {
      ...draft,
      stt: { ...draft.stt, wakeSamples: [] },
    };
    setDraft(cleared);
    settingsStore.save(cleared).catch((error: unknown) => {
      void logError("clear_wake_samples", error);
    });
    setEnrolling(true);
  };

  const cancelWakeEnrollment = () => {
    setEnrolling(false);
    voiceEngine.resumeAfterEnrollment();
    setBusy(false);
    setMessage("登録を中断しました");
  };

  const finishWakeEnrollment = async (samples: string[]) => {
    setEnrolling(false);
    voiceEngine.resumeAfterEnrollment();
    const base = draftRef.current;
    if (!base) {
      setBusy(false);
      return;
    }
    const next: Settings = {
      ...base,
      stt: { ...base.stt, wakeSamples: samples },
    };
    setDraft(next);
    try {
      await settingsStore.save(next);
      setMessage(
        `呼びかけを${samples.length}回分記録しました。認識候補は保存済みです`,
      );
    } catch (error) {
      void logError("save_wake_samples", error);
      setMessage(`呼びかけの保存に失敗しました: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const autoTuneThreshold = async () => {
    if (!voiceEngine.pauseForEnrollment()) {
      setMessage("音声処理が終わってから校正してください");
      return;
    }

    setBusy(true);
    setCalibratingThreshold(true);
    try {
      const levels = await measureNoiseFloor(draft.stt.inputDeviceId);
      if (levels.length < 20) {
        throw new Error("周囲の音を十分に測定できませんでした");
      }
      levels.sort((a, b) => a - b);
      const noiseFloor = levels[Math.floor((levels.length - 1) * 0.9)];
      const threshold = Math.min(
        0.4,
        Math.max(0.002, Number((noiseFloor * 2.5 + 0.003).toFixed(4))),
      );
      patch({ stt: { ...draft.stt, threshold } });
      setMessage(`VAD しきい値を ${threshold} に調整しました`);
    } catch (error) {
      void logError("calibrate_vad_threshold", error);
      setMessage(`しきい値を校正できませんでした: ${String(error)}`);
    } finally {
      voiceEngine.resumeAfterEnrollment();
      setBusy(false);
      setCalibratingThreshold(false);
    }
  };

  const downloadModel = async () => {
    setBusy(true);
    setDownloadProgress(0);
    try {
      await downloadSpeechModel();
      setModelStatus(await speechModelStatus());
      setMessage("音声認識モデルを取得しました");
    } catch (error) {
      void logError("download_speech_model", error);
      setMessage(`モデルの取得に失敗しました: ${String(error)}`);
    } finally {
      setDownloadProgress(null);
      setBusy(false);
    }
  };

  const installBinary = async () => {
    setBusy(true);
    setDownloadProgress(0);
    try {
      const path = await installSpeechBinary();
      if (path) {
        patch({ stt: { ...draft.stt, speechPath: path } });
      }
      setMessage("speech.cpp を取得しました");
    } catch (error) {
      void logError("install_speech_binary", error);
      setMessage(`speech.cpp の取得に失敗しました: ${String(error)}`);
    } finally {
      setDownloadProgress(null);
      setBusy(false);
    }
  };

  const modelHint = modelStatus
    ? modelStatus.present
      ? `取得済み ${(modelStatus.bytes / 1_048_576).toFixed(0)}MB`
      : `未取得 ${(modelStatus.expectedBytes / 1_048_576).toFixed(0)}MB`
    : "確認中";

  const applyHudPreset = (preset: string) => {
    const margin = 24;
    const width = draft.hud.width;
    const height = draft.hud.height;
    const availWidth = window.screen?.availWidth ?? 1920;
    const availHeight = window.screen?.availHeight ?? 1080;
    let x = draft.hud.positionX;
    let y = draft.hud.positionY;
    if (preset === "top-left") {
      x = margin;
      y = margin;
    } else if (preset === "top-right") {
      x = Math.max(0, availWidth - width - margin);
      y = margin;
    } else if (preset === "bottom-left") {
      x = margin;
      y = Math.max(0, availHeight - height - margin - 48);
    } else if (preset === "bottom-right") {
      x = Math.max(0, availWidth - width - margin);
      y = Math.max(0, availHeight - height - margin - 48);
    }
    patch({
      ui: { ...draft.ui, hudPreset: preset },
      hud: { ...draft.hud, positionX: x, positionY: y },
    });
  };

  const moveProvider = (index: number, delta: number) => {
    const order = [...draft.providers.order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    patch({ providers: { ...draft.providers, order } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[90vh] max-h-[92vh] w-full max-w-[min(1400px,94vw)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              設定
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {settings?.dataDir ? `データ: ${settings.dataDir}` : "\u00a0"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 space-y-1 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => jumpToSection(section.id)}
                className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] transition ${
                  activeSection === section.id
                    ? "bg-[var(--bg-hover)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {section.label}
              </button>
            ))}
            <p className="px-2 pt-2 text-[9px] leading-relaxed text-[var(--text-muted)]">
              「保存」で反映されます。HUD固定時は現在の位置を記憶します。
            </p>
          </nav>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Section id="settings-providers" title="プロバイダ / フォールバック順">
            {draft.providers.order.map((id, index) => (
              <div
                key={id}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {index + 1}. {PROVIDER_LABELS[id] ?? id}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveProvider(index, -1)}
                    className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-muted)] transition hover:text-[var(--accent)]"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveProvider(index, 1)}
                    className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-muted)] transition hover:text-[var(--accent)]"
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button
                    type="button"
                    disabled={draft.providers.order.length <= 1}
                    onClick={() =>
                      patch({
                        providers: {
                          ...draft.providers,
                          order: draft.providers.order.filter(
                            (item) => item !== id,
                          ),
                        },
                      })
                    }
                    className="rounded border border-[var(--border-subtle)] p-1 text-[var(--text-muted)] transition hover:text-[var(--error)] disabled:opacity-30"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            ))}

            {ALL_PROVIDERS.filter(
              (id) => !draft.providers.order.includes(id),
            ).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  patch({
                    providers: {
                      ...draft.providers,
                      order: [...draft.providers.order, id],
                    },
                  })
                }
                className="flex w-full items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-muted)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
              >
                <Plus size={10} /> {PROVIDER_LABELS[id]} を追加
              </button>
            ))}

            <Row label="Gemini モデル">
              <input
                value={draft.providers.geminiModel}
                onChange={(event) =>
                  patch({
                    providers: {
                      ...draft.providers,
                      geminiModel: event.target.value,
                    },
                  })
                }
                className={INPUT_CLASS}
              />
            </Row>
            <Row
              label="モデル自動振り分け"
              hint="短い質問はOllama、重い質問はクラウド"
            >
              <Switch
                checked={draft.providers.autoRoute}
                onChange={(autoRoute) =>
                  patch({ providers: { ...draft.providers, autoRoute } })
                }
              />
            </Row>
            <Row label="Ollama モデル">
              <input
                value={draft.providers.ollamaModel}
                onChange={(event) =>
                  patch({
                    providers: {
                      ...draft.providers,
                      ollamaModel: event.target.value,
                    },
                  })
                }
                className={INPUT_CLASS}
              />
            </Row>
            <Row label="Ollama URL">
              <input
                value={draft.providers.ollamaBaseUrl}
                onChange={(event) =>
                  patch({
                    providers: {
                      ...draft.providers,
                      ollamaBaseUrl: event.target.value,
                    },
                  })
                }
                className={INPUT_CLASS}
              />
            </Row>

            <div className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2">
              <p className="text-[10px] font-medium text-[var(--text-secondary)]">
                OpenCode Go（`opencode web` サーバー）
              </p>
              <Row label="Base URL" hint="/v1 まで含める">
                <input
                  value={draft.providers.opencodeBaseUrl}
                  onChange={(event) =>
                    patch({
                      providers: {
                        ...draft.providers,
                        opencodeBaseUrl: event.target.value,
                      },
                    })
                  }
                  placeholder="http://192.168.0.10:3000/v1"
                  className={INPUT_CLASS}
                />
              </Row>
              <Row label="モデル（通常）">
                <input
                  value={draft.providers.opencodeModel}
                  onChange={(event) =>
                    patch({
                      providers: {
                        ...draft.providers,
                        opencodeModel: event.target.value,
                      },
                    })
                  }
                  placeholder="deepseek-v4.1-flash"
                  className={INPUT_CLASS}
                />
              </Row>
              <Row label="モデル（重量級）" hint="自動振り分け用">
                <input
                  value={draft.providers.opencodeHeavyModel}
                  onChange={(event) =>
                    patch({
                      providers: {
                        ...draft.providers,
                        opencodeHeavyModel: event.target.value,
                      },
                    })
                  }
                  placeholder="deepseek-v4.1-pro"
                  className={INPUT_CLASS}
                />
              </Row>
              <Row
                label="OpenCode API キー"
                hint={settings?.hasOpencodeKey ? "保存済み（DPAPI）" : "未設定"}
              >
                <input
                  type="password"
                  value={opencodeKey}
                  onChange={(event) => setOpencodeKey(event.target.value)}
                  placeholder={
                    settings?.hasOpencodeKey ? "••••••••" : "oc_sk_..."
                  }
                  className={INPUT_CLASS}
                />
              </Row>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void saveOpencodeKey()}
                  disabled={busy}
                  className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  キーを保存
                </button>
              </div>
            </div>

            <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
              <Row
                label="Gemini API キー"
                hint={settings?.hasGeminiKey ? "保存済み（DPAPI）" : "未設定"}
              >
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    settings?.hasGeminiKey ? "••••••••" : "AIza..."
                  }
                  className={INPUT_CLASS}
                />
              </Row>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void saveKey()}
                  disabled={busy}
                  className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  キーを保存
                </button>
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-50"
                >
                  <PlugZap size={10} /> 接続テスト
                </button>
                {checks?.map((check) => (
                  <span
                    key={check.id}
                    title={check.detail}
                    className={`text-[10px] ${
                      check.ok ? "text-[var(--ok)]" : "text-[var(--error)]"
                    }`}
                  >
                    {check.label}: {check.ok ? "OK" : "NG"}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          <Section id="settings-conversation" title="会話">
            <Row
              label="呼び名"
              hint="起動時は「〇〇様」と挨拶（様は入力不要）"
            >
              <input
                value={draft.preferredName}
                maxLength={32}
                onChange={(event) =>
                  patch({ preferredName: event.target.value })
                }
                placeholder="ボス"
                className={INPUT_CLASS}
              />
            </Row>
            <div className="py-1.5">
              <p className="mb-1 text-[11px] text-[var(--text-secondary)]">
                システムプロンプト
              </p>
              <textarea
                value={draft.systemPrompt}
                onChange={(event) =>
                  patch({ systemPrompt: event.target.value })
                }
                rows={4}
                className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-dim)] select-text"
              />
            </div>
            <Row label="Temperature">
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={draft.temperature}
                onChange={(event) =>
                  patch({ temperature: Number(event.target.value) })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <Row label="履歴として送るメッセージ数">
              <input
                type="number"
                min="2"
                max="100"
                value={draft.maxHistory}
                onChange={(event) =>
                  patch({ maxHistory: Number(event.target.value) })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
          </Section>

          <Section id="settings-tts" title="音声出力（TTS）">
            <Row label="読み上げ">
              <Switch
                checked={draft.tts.enabled}
                onChange={(enabled) =>
                  patch({ tts: { ...draft.tts, enabled } })
                }
              />
            </Row>
            <Row label="エンジン">
              <select
                value={draft.tts.engine}
                onChange={(event) =>
                  patch({
                    tts: {
                      ...draft.tts,
                      engine: event.target.value as "edge" | "sapi",
                    },
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="edge">edge-tts</option>
                <option value="sapi">Windows SAPI</option>
              </select>
            </Row>
            <Row label="Edge ボイス">
              <select
                value={
                  EDGE_VOICES.some(([id]) => id === draft.tts.voice)
                    ? draft.tts.voice
                    : "custom"
                }
                onChange={(event) => {
                  if (event.target.value !== "custom") {
                    patch({ tts: { ...draft.tts, voice: event.target.value } });
                  }
                }}
                className={INPUT_CLASS}
              >
                {EDGE_VOICES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
                <option value="custom">カスタム（下欄）</option>
              </select>
            </Row>
            <Row label="Edge ボイスID" hint="任意">
              <input
                value={draft.tts.voice}
                onChange={(event) =>
                  patch({ tts: { ...draft.tts, voice: event.target.value } })
                }
                className={INPUT_CLASS}
              />
            </Row>
            <Row label="SAPI ボイス" hint="空欄で既定">
              <input
                value={draft.tts.sapiVoice}
                onChange={(event) =>
                  patch({
                    tts: { ...draft.tts, sapiVoice: event.target.value },
                  })
                }
                className={INPUT_CLASS}
              />
            </Row>
            <Row label="速度（%）">
              <input
                type="number"
                min="-100"
                max="100"
                step="5"
                value={draft.tts.rate}
                onChange={(event) =>
                  patch({ tts: { ...draft.tts, rate: Number(event.target.value) } })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <Row label="音量（%）">
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                value={draft.tts.volume}
                onChange={(event) =>
                  patch({
                    tts: { ...draft.tts, volume: Number(event.target.value) },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <Row label="ピッチ（%）" hint="低いほど落ち着いた声">
              <input
                type="number"
                min="-100"
                max="100"
                step="5"
                value={draft.tts.pitch}
                onChange={(event) =>
                  patch({
                    tts: { ...draft.tts, pitch: Number(event.target.value) },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <Row
              label="割り込み（バージイン）"
              hint="発話中に話すと読み上げを止めます"
            >
              <Switch
                checked={draft.tts.bargeIn}
                onChange={(bargeIn) =>
                  patch({ tts: { ...draft.tts, bargeIn } })
                }
              />
            </Row>
          </Section>

          <Section id="settings-stt" title="音声入力（STT）">
            <Row label="音声入力">
              <Switch
                checked={draft.stt.enabled}
                onChange={(enabled) =>
                  patch({ stt: { ...draft.stt, enabled } })
                }
              />
            </Row>
            <Row label="認識エンジン" hint={settings?.sttDetail}>
              <select
                value={draft.stt.engine}
                onChange={(event) => {
                  const engine = event.target.value as Settings["stt"]["engine"];
                  patch({ stt: { ...draft.stt, engine } });
                }}
                className={`${INPUT_CLASS} w-[210px]`}
              >
                <option value="speech">speech.cpp（Haas-ja・高速）</option>
                <option value="whisper">whisper.cpp</option>
              </select>
            </Row>
            <Row label="マイク入力" hint="文字起こしに使う入力デバイス">
              <span className="flex items-center gap-1">
                <select
                  value={draft.stt.inputDeviceId}
                  onChange={(event) =>
                    patch({
                      stt: {
                        ...draft.stt,
                        inputDeviceId: event.target.value,
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[190px]`}
                >
                  <option value="">システム既定</option>
                  {inputDevices.map((device, index) => (
                    <option
                      key={device.deviceId || `input-${index}`}
                      value={device.deviceId}
                    >
                      {device.label || `マイク ${index + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadInputDevices(true)}
                  title="マイク一覧を更新（初回は許可が必要）"
                  className="shrink-0 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
                >
                  更新
                </button>
              </span>
            </Row>
            {draft.stt.engine === "speech" ? (
              <>
                <Row
                  label="speech.exe"
                  hint={settings?.sttAvailable ? "検出済み" : "未検出"}
                >
                  <span className="flex items-center gap-1">
                    <input
                      value={draft.stt.speechPath}
                      onChange={(event) =>
                        patch({
                          stt: { ...draft.stt, speechPath: event.target.value },
                        })
                      }
                      placeholder="C:\\tools\\speech\\speech.exe"
                      title={draft.stt.speechPath}
                      className={`${INPUT_CLASS} w-[130px]`}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const path = await pickFile({
                          title: "speech.exe を選択",
                          filter:
                            "実行ファイル (*.exe)|*.exe|すべてのファイル (*.*)|*.*",
                        });
                        if (path) {
                          patch({ stt: { ...draft.stt, speechPath: path } });
                        }
                      }}
                      className="shrink-0 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
                    >
                      <FolderOpen size={10} /> 参照
                    </button>
                    <button
                      type="button"
                      onClick={() => void installBinary()}
                      disabled={busy || downloadProgress !== null}
                      title="speech.cpp の最新 Windows 版を取得します"
                      className="shrink-0 rounded-md border border-[var(--accent-dim)] px-1.5 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      <Download size={10} /> 取得
                    </button>
                  </span>
                </Row>
                <Row label="認識モデル" hint={modelHint}>
                  <span className="flex items-center gap-1">
                    <input
                      value={draft.stt.speechModel}
                      onChange={(event) =>
                        patch({
                          stt: {
                            ...draft.stt,
                            speechModel: event.target.value,
                          },
                        })
                      }
                      title={modelStatus?.path ?? undefined}
                      placeholder="haas-ja-v1.0"
                      className={`${INPUT_CLASS} w-[130px]`}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const path = await pickFile({
                          title: "GGUF モデルを選択",
                          filter: "GGUF モデル (*.gguf)|*.gguf|すべてのファイル (*.*)|*.*",
                        });
                        if (path) {
                          patch({ stt: { ...draft.stt, speechModel: path } });
                        }
                      }}
                      className="shrink-0 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
                    >
                      <FolderOpen size={10} /> 参照
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadModel()}
                      disabled={busy || downloadProgress !== null}
                      className="shrink-0 rounded-md border border-[var(--accent-dim)] px-1.5 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      <Download size={10} /> 取得
                    </button>
                  </span>
                </Row>
                {downloadProgress !== null && (
                  <p className="text-right text-[10px] text-[var(--accent)]">
                    モデルをダウンロード中... {(downloadProgress * 100).toFixed(0)}%
                  </p>
                )}
                <Row label="実行デバイス">
                  <select
                    value={draft.stt.speechDevice}
                    onChange={(event) =>
                      patch({
                        stt: {
                          ...draft.stt,
                          speechDevice: event.target
                            .value as Settings["stt"]["speechDevice"],
                        },
                      })
                    }
                    className={`${INPUT_CLASS} w-[120px]`}
                  >
                    <option value="auto">自動</option>
                    <option value="gpu">GPU</option>
                    <option value="cpu">CPU</option>
                  </select>
                </Row>
                <Row
                  label="起動語を語彙に登録"
                  hint="Haas のカスタム語彙で「ジャービス」を認識"
                >
                  <Switch
                    checked={draft.stt.speechKeywords}
                    onChange={(speechKeywords) =>
                      patch({ stt: { ...draft.stt, speechKeywords } })
                    }
                  />
                </Row>
              </>
            ) : (
              <>
                <PathRow
                  label="whisper-cli.exe"
                  hint={settings?.sttAvailable ? "検出済み" : "未検出"}
                  title="whisper-cli.exe を選択"
                  mode="file"
                  filter="実行ファイル (*.exe)|*.exe|すべてのファイル (*.*)|*.*"
                  value={draft.stt.whisperPath}
                  placeholder="C:\\tools\\whisper\\whisper-cli.exe"
                  onChange={(whisperPath) =>
                    patch({ stt: { ...draft.stt, whisperPath } })
                  }
                />
                <PathRow
                  label="ggml モデル"
                  title="Whisper モデル (*.bin) を選択"
                  mode="file"
                  filter="Whisper モデル (*.bin)|*.bin|すべてのファイル (*.*)|*.*"
                  value={draft.stt.modelPath}
                  placeholder="C:\\tools\\whisper\\ggml-small.bin"
                  onChange={(modelPath) =>
                    patch({ stt: { ...draft.stt, modelPath } })
                  }
                />
                <Row label="言語">
                  <input
                    value={draft.stt.language}
                    onChange={(event) =>
                      patch({
                        stt: { ...draft.stt, language: event.target.value },
                      })
                    }
                    className={`${INPUT_CLASS} w-[90px]`}
                  />
                </Row>
                <Row
                  label="Whisper プロンプト"
                  hint="空欄推奨。入れると語彙を誘導します（起動語プロンプトは廃止）"
                >
                  <input
                    value={draft.stt.whisperPrompt}
                    onChange={(event) =>
                      patch({
                        stt: {
                          ...draft.stt,
                          whisperPrompt: event.target.value,
                        },
                      })
                    }
                    placeholder="（空欄）"
                    className={INPUT_CLASS}
                  />
                </Row>
              </>
            )}
            <Row label="無音判定（ms）">
              <input
                type="number"
                min="200"
                max="5000"
                step="100"
                value={draft.stt.silenceMs}
                onChange={(event) =>
                  patch({
                    stt: {
                      ...draft.stt,
                      silenceMs: Number(event.target.value),
                    },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <div className="flex flex-wrap gap-1 pb-2">
              {[800, 1200, 1500].map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() =>
                    patch({ stt: { ...draft.stt, silenceMs: ms } })
                  }
                  className={`rounded border px-2 py-0.5 text-[10px] transition ${
                    draft.stt.silenceMs === ms
                      ? "border-[var(--accent-dim)] text-[var(--accent)]"
                      : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--accent)]"
                  }`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
            <div className="flex justify-end pb-2">
              <button
                type="button"
                onClick={() => setVoiceLabOpen(true)}
                className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)]"
              >
                音声テスト（録音・CER比較）を開く
              </button>
            </div>
            <Row label="VAD しきい値" hint="小さいほど敏感">
              <input
                type="number"
                min="0.002"
                max="0.4"
                step="0.005"
                value={draft.stt.threshold}
                onChange={(event) =>
                  patch({
                    stt: {
                      ...draft.stt,
                      threshold: Number(event.target.value),
                    },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <div className="flex justify-end pb-2">
              <button
                type="button"
                onClick={() => void autoTuneThreshold()}
                disabled={busy || !settings?.sttAvailable}
                className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-40"
              >
                {calibratingThreshold
                  ? "周囲の音を測定中..."
                  : "周囲の音から自動調整"}
              </button>
            </div>
            <Row
              label="ノイズ除去（前処理）"
              hint="低周波・高周波ノイズと定常ノイズを抑えます"
            >
              <Switch
                checked={draft.stt.denoise}
                onChange={(denoise) =>
                  patch({ stt: { ...draft.stt, denoise } })
                }
              />
            </Row>
            <Row
              label="ノイズ除去エンジン"
              hint="RNNoiseは高品質、簡易は軽量"
            >
              <select
                value={draft.stt.denoiseEngine}
                onChange={(event) =>
                  patch({
                    stt: {
                      ...draft.stt,
                      denoiseEngine: event.target.value as
                        | "rnnoise"
                        | "classic",
                    },
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="rnnoise">RNNoise（推奨）</option>
                <option value="classic">簡易フィルタ＋ゲート</option>
              </select>
            </Row>
            <Row
              label="音量の一定化（前処理）"
              hint="小さい声を自動で持ち上げ、大きすぎる声を抑えます"
            >
              <Switch
                checked={draft.stt.normalize}
                onChange={(normalize) =>
                  patch({ stt: { ...draft.stt, normalize } })
                }
              />
            </Row>
            <Row
              label="ハンズフリー（VAD 自動ターン交代）"
              hint="有効時に待機。起動語はJARVIS"
            >
              <Switch
                checked={draft.stt.handsFree}
                onChange={(handsFree) =>
                  patch({ stt: { ...draft.stt, handsFree } })
                }
              />
            </Row>
            <Row
              label="起動語の常時監視"
              hint="待機中も短い音声を監視（CPU負荷あり）"
            >
              <Switch
                checked={draft.stt.wakeWatch}
                onChange={(wakeWatch) =>
                  patch({ stt: { ...draft.stt, wakeWatch } })
                }
              />
            </Row>
            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
              <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                「ジャービス」と呼びかける録音を5回行い、聞き取れた言い方を
                認識候補として保存します。音声は保存せず文字起こしだけを端末内に
                保存します。ボタンを押すと既存の登録はすべて削除されます。
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--text-secondary)]">
                  登録数: {draft.stt.wakeSamples.length}/5
                </span>
                <button
                  type="button"
                  onClick={startWakeEnrollment}
                  disabled={busy || !settings?.sttAvailable}
                  className="shrink-0 rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  呼びかけを登録（5回）
                </button>
              </div>
              {draft.stt.wakeSamples.length > 0 && (
                <ul className="space-y-1">
                  {draft.stt.wakeSamples.map((sample, index) => (
                    <li
                      key={`${sample}-${index}`}
                      className="flex items-center justify-between rounded border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
                    >
                      <span>
                        {index + 1}. {sample}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            stt: {
                              ...draft.stt,
                              wakeSamples: draft.stt.wakeSamples.filter(
                                (_, sampleIndex) => sampleIndex !== index,
                              ),
                            },
                          })
                        }
                        disabled={busy}
                        aria-label={`${sample}を削除`}
                        className="text-[var(--text-muted)] hover:text-[var(--error)] disabled:opacity-40"
                      >
                        <X size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section id="settings-tools" title="ツール実行（Function Calling）">
            <Row
              label="ツール実行を有効化"
              hint="モデルが必要に応じて検索・ファイル操作などを呼びます"
            >
              <Switch
                checked={draft.tools.enabled}
                onChange={(enabled) =>
                  patch({ tools: { ...draft.tools, enabled } })
                }
              />
            </Row>
            <Row label="Web検索（DuckDuckGo）">
              <Switch
                checked={draft.tools.webSearch}
                onChange={(webSearch) =>
                  patch({ tools: { ...draft.tools, webSearch } })
                }
              />
            </Row>
            <Row label="アプリ起動 / URLを開く">
              <Switch
                checked={draft.tools.shell}
                onChange={(shell) =>
                  patch({ tools: { ...draft.tools, shell } })
                }
              />
            </Row>
            <Row label="ファイル読み書き">
              <Switch
                checked={draft.tools.files}
                onChange={(files) =>
                  patch({ tools: { ...draft.tools, files } })
                }
              />
            </Row>
            <Row label="クリップボード">
              <Switch
                checked={draft.tools.clipboard}
                onChange={(clipboard) =>
                  patch({ tools: { ...draft.tools, clipboard } })
                }
              />
            </Row>
            <Row label="スクリーンショット">
              <Switch
                checked={draft.tools.screenshot}
                onChange={(screenshot) =>
                  patch({ tools: { ...draft.tools, screenshot } })
                }
              />
            </Row>
            <Row label="タイマー / デスクトップ通知">
              <Switch
                checked={draft.tools.timers}
                onChange={(timers) =>
                  patch({ tools: { ...draft.tools, timers } })
                }
              />
            </Row>
            <Row label="実行前に確認" hint="書き込み・起動時に確認ダイアログ">
              <Switch
                checked={draft.tools.approval}
                onChange={(approval) =>
                  patch({ tools: { ...draft.tools, approval } })
                }
              />
            </Row>

            <div className="mt-2 space-y-2 border-t border-[var(--border-subtle)] pt-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                  MCP サーバー（stdio）。引数はスペース区切り。
                </p>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      tools: {
                        ...draft.tools,
                        mcpServers: [
                          ...draft.tools.mcpServers,
                          { name: "", command: "", args: [], enabled: true },
                        ],
                      },
                    })
                  }
                  className="flex shrink-0 items-center gap-0.5 rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                >
                  <Plus size={10} /> 追加
                </button>
              </div>
              {draft.tools.mcpServers.map((server, index) => (
                <div
                  key={index}
                  className="space-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
                >
                  <div className="flex items-center gap-1">
                    <input
                      value={server.name}
                      placeholder="名前"
                      onChange={(event) => {
                        const servers = draft.tools.mcpServers.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                        );
                        patch({ tools: { ...draft.tools, mcpServers: servers } });
                      }}
                      className="w-[92px] rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 text-[10px] outline-none select-text"
                    />
                    <input
                      value={server.command}
                      placeholder="command (例: npx)"
                      onChange={(event) => {
                        const servers = draft.tools.mcpServers.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, command: event.target.value }
                              : item,
                        );
                        patch({ tools: { ...draft.tools, mcpServers: servers } });
                      }}
                      className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 text-[10px] outline-none select-text"
                    />
                    <Switch
                      checked={server.enabled}
                      onChange={(enabled) => {
                        const servers = draft.tools.mcpServers.map(
                          (item, itemIndex) =>
                            itemIndex === index ? { ...item, enabled } : item,
                        );
                        patch({ tools: { ...draft.tools, mcpServers: servers } });
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          tools: {
                            ...draft.tools,
                            mcpServers: draft.tools.mcpServers.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          },
                        })
                      }
                      className="text-[var(--text-muted)] hover:text-[var(--error)]"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <input
                    value={server.args.join(" ")}
                    placeholder="args（例: -y @modelcontextprotocol/server-filesystem C:\docs）"
                    onChange={(event) => {
                      const args = event.target.value
                        .split(/\s+/)
                        .map((arg) => arg.trim())
                        .filter(Boolean);
                      const servers = draft.tools.mcpServers.map(
                        (item, itemIndex) =>
                          itemIndex === index ? { ...item, args } : item,
                      );
                      patch({ tools: { ...draft.tools, mcpServers: servers } });
                    }}
                    className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 text-[10px] outline-none select-text"
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section id="settings-memory" title="長期記憶">
            <Row label="長期記憶を有効化">
              <Switch
                checked={draft.memory.enabled}
                onChange={(enabled) =>
                  patch({ memory: { ...draft.memory, enabled } })
                }
              />
            </Row>
            <Row label="応答に記憶を注入">
              <Switch
                checked={draft.memory.inject}
                onChange={(inject) =>
                  patch({ memory: { ...draft.memory, inject } })
                }
              />
            </Row>
            <Row
              label="会話から自動抽出"
              hint="数ターンごとに事実を記憶します"
            >
              <Switch
                checked={draft.memory.autoExtract}
                onChange={(autoExtract) =>
                  patch({ memory: { ...draft.memory, autoExtract } })
                }
              />
            </Row>
            <Row label="長い会話を自動要約">
              <Switch
                checked={draft.memory.autoSummarize}
                onChange={(autoSummarize) =>
                  patch({ memory: { ...draft.memory, autoSummarize } })
                }
              />
            </Row>
            <Row label="注入する記憶の最大数">
              <input
                type="number"
                min="0"
                max="40"
                value={draft.memory.maxItems}
                onChange={(event) =>
                  patch({
                    memory: {
                      ...draft.memory,
                      maxItems: Number(event.target.value),
                    },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              記憶の確認・編集は「記憶とテンプレート」から行えます。
            </p>
          </Section>

          <Section id="settings-display" title="表示 / クリップボード">
            <Row label="テーマ">
              <select
                value={draft.ui.theme}
                onChange={(event) =>
                  patch({
                    ui: {
                      ...draft.ui,
                      theme: event.target.value as "dark" | "light",
                    },
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="dark">ダーク（HUD）</option>
                <option value="light">ライト</option>
              </select>
            </Row>
            <Row label="文字サイズ" hint={`${draft.ui.fontScale.toFixed(2)}x`}>
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.05"
                value={draft.ui.fontScale}
                onChange={(event) =>
                  patch({
                    ui: { ...draft.ui, fontScale: Number(event.target.value) },
                  })
                }
                className="w-[150px]"
              />
            </Row>
            <Row label="HUD 配置プリセット">
              <select
                value={draft.ui.hudPreset}
                onChange={(event) => applyHudPreset(event.target.value)}
                className={INPUT_CLASS}
              >
                <option value="custom">カスタム</option>
                <option value="top-left">左上</option>
                <option value="top-right">右上</option>
                <option value="bottom-left">左下</option>
                <option value="bottom-right">右下</option>
              </select>
            </Row>
            <Row label="HUD テーマ" hint="1色から配色を自動生成">
              <div className="flex flex-wrap items-center gap-1">
                {HUD_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    title={theme.label}
                    onClick={() =>
                      patch({
                        ui: {
                          ...draft.ui,
                          hudTheme: theme.id,
                          hudAccent: theme.accent,
                        },
                      })
                    }
                    className={`h-5 w-5 rounded-full border transition ${
                      draft.ui.hudTheme === theme.id
                        ? "scale-110 border-[var(--text-primary)]"
                        : "border-[var(--border-strong)]"
                    }`}
                    style={{ background: theme.accent }}
                  />
                ))}
                <input
                  type="color"
                  title="カスタムカラー"
                  value={
                    isHexColor(draft.ui.hudAccent)
                      ? draft.ui.hudAccent
                      : DEFAULT_ACCENT
                  }
                  onChange={(event) =>
                    patch({
                      ui: {
                        ...draft.ui,
                        hudTheme: "custom",
                        hudAccent: event.target.value,
                      },
                    })
                  }
                  className="h-6 w-8 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent"
                />
              </div>
            </Row>
            <Row
              label="クリップボードを監視"
              hint="長いコピーを検知して要約を提案"
            >
              <Switch
                checked={draft.ui.clipboardWatch}
                onChange={(clipboardWatch) =>
                  patch({ ui: { ...draft.ui, clipboardWatch } })
                }
              />
            </Row>
          </Section>

          <Section id="settings-services" title="ローカルサービス">
            <LocalServicesSettings
              services={draft.services}
              onChange={(services) => patch({ services })}
            />
          </Section>

          <Section id="settings-data" title="データ">
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  void exportAll("markdown")
                    .then((path) => setMessage(`書き出しました: ${path}`))
                    .catch((error) => setMessage(`失敗: ${String(error)}`));
                }}
                className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                <Download size={10} /> 全スレッドを Markdown
              </button>
              <button
                type="button"
                onClick={() => {
                  void exportAll("json")
                    .then((path) => setMessage(`書き出しました: ${path}`))
                    .catch((error) => setMessage(`失敗: ${String(error)}`));
                }}
                className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                <Download size={10} /> JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  void backupDatabase()
                    .then((path) => setMessage(`バックアップ: ${path}`))
                    .catch((error) => setMessage(`失敗: ${String(error)}`));
                }}
                className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                <Database size={10} /> DB バックアップ
              </button>
            </div>
            <p className="pt-1 text-[10px] text-[var(--text-muted)]">
              保存先: {settings?.dataDir ? `${settings.dataDir}\\exports` : "—"}
            </p>
          </Section>

          <Section id="settings-window" title="ウィンドウ">
            <Row
              label="HUDを固定"
              hint="この位置で固定します"
            >
              <Switch
                checked={draft.hud.pinned}
                onChange={async (pinned) => {
                  if (pinned) {
                    const geometry = await getHudGeometry();
                    if (geometry) {
                      patch({
                        hud: {
                          ...draft.hud,
                          pinned,
                          positionX: geometry.x,
                          positionY: geometry.y,
                          width: geometry.width,
                          height: geometry.height,
                        },
                        ui: { ...draft.ui, hudPreset: "custom" },
                      });
                      return;
                    }
                  }
                  patch({ hud: { ...draft.hud, pinned } });
                }}
              />
            </Row>
            <div className="flex justify-end gap-2 pb-2">
              <button
                type="button"
                onClick={() =>
                  patch({ hud: { ...draft.hud, width: 760, height: 480 } })
                }
                className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
              >
                ダッシュボード向け (760×480)
              </button>
              <button
                type="button"
                onClick={() => {
                  void getHudGeometry().then((geometry) => {
                    if (!geometry) {
                      setMessage("HUD ウィンドウが見つかりません");
                      return;
                    }
                    patch({
                      hud: {
                        ...draft.hud,
                        positionX: geometry.x,
                        positionY: geometry.y,
                        width: geometry.width,
                        height: geometry.height,
                      },
                      ui: { ...draft.ui, hudPreset: "custom" },
                    });
                    setMessage("現在のHUD位置を設定に反映しました");
                  });
                }}
                className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
              >
                現在のHUD位置を記憶
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                幅
                <input
                  type="number"
                  min="380"
                  max="1920"
                  value={draft.hud.width}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        width: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[90px]`}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                高さ
                <input
                  type="number"
                  min="208"
                  max="1080"
                  value={draft.hud.height}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        height: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[90px]`}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                X座標
                <input
                  type="number"
                  min="-16384"
                  max="16384"
                  value={draft.hud.positionX}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        positionX: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[90px]`}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                Y座標
                <input
                  type="number"
                  min="-16384"
                  max="16384"
                  value={draft.hud.positionY}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        positionY: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[90px]`}
                />
              </label>
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              固定を有効にすると待機中は背面に表示し、ウェイクワードの後は
              回答終了から10秒後に背面へ戻ります。変更は保存後に反映されます。
            </p>
            <Row label="HUD をクリック透過">
              <Switch
                checked={draft.hud.clickThrough}
                onChange={(clickThrough) =>
                  patch({ hud: { ...draft.hud, clickThrough } })
                }
              />
            </Row>
            <Row label="静止モード" hint="リングとブラーを止めてCPUを節約">
              <Switch
                checked={draft.hud.staticMode}
                onChange={(staticMode) =>
                  patch({ hud: { ...draft.hud, staticMode } })
                }
              />
            </Row>
            <Row label="ダッシュボード: 時計">
              <Switch
                checked={draft.hud.showClock}
                onChange={(showClock) =>
                  patch({ hud: { ...draft.hud, showClock } })
                }
              />
            </Row>
            <Row label="ダッシュボード: システム">
              <Switch
                checked={draft.hud.showSystem}
                onChange={(showSystem) =>
                  patch({ hud: { ...draft.hud, showSystem } })
                }
              />
            </Row>
            <Row label="ダッシュボード: 天気">
              <Switch
                checked={draft.hud.showWeather}
                onChange={(showWeather) =>
                  patch({ hud: { ...draft.hud, showWeather } })
                }
              />
            </Row>
            <Row label="ダッシュボード: 使用量">
              <Switch
                checked={draft.hud.showUsage}
                onChange={(showUsage) =>
                  patch({ hud: { ...draft.hud, showUsage } })
                }
              />
            </Row>
            <Row label="天気の地点" hint="名称 / 緯度 / 経度">
              <div className="flex items-center gap-1">
                <input
                  value={draft.hud.weatherCity}
                  onChange={(event) =>
                    patch({
                      hud: { ...draft.hud, weatherCity: event.target.value },
                    })
                  }
                  className={`${INPUT_CLASS} w-[84px]`}
                />
                <input
                  type="number"
                  step="0.0001"
                  value={draft.hud.weatherLat}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        weatherLat: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[76px]`}
                />
                <input
                  type="number"
                  step="0.0001"
                  value={draft.hud.weatherLon}
                  onChange={(event) =>
                    patch({
                      hud: {
                        ...draft.hud,
                        weatherLon: Number(event.target.value),
                      },
                    })
                  }
                  className={`${INPUT_CLASS} w-[76px]`}
                />
              </div>
            </Row>
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              ダッシュボードは HUD の幅を 600px 以上にすると表示されます。
            </p>
            <Row label="起動時に最小化（トレイ常駐）">
              <Switch
                checked={draft.startMinimized}
                onChange={(startMinimized) => patch({ startMinimized })}
              />
            </Row>
          </Section>

          <Section id="settings-update" title="アップデート">
            <Row label="現在のバージョン">
              <span className="text-[11px] text-[var(--text-secondary)]">
                v{update?.currentVersion ?? "—"}
              </span>
            </Row>
            <PathRow
              label="更新元フォルダ"
              hint="latest.json と exe を置いた場所"
              title="更新元フォルダを選択"
              mode="folder"
              value={draft.updates.folder}
              placeholder="D:\\リポジトリ\\updates"
              onChange={(folder) =>
                patch({ updates: { ...draft.updates, folder } })
              }
            />
            <Row
              label="更新元を監視"
              hint="指定フォルダの latest.json と exe を定期確認します"
            >
              <Switch
                checked={draft.updates.watch}
                onChange={(watch) =>
                  patch({ updates: { ...draft.updates, watch } })
                }
              />
            </Row>
            <Row label="確認間隔（秒）">
              <input
                type="number"
                min="15"
                max="3600"
                step="15"
                value={draft.updates.pollSeconds}
                onChange={(event) =>
                  patch({
                    updates: {
                      ...draft.updates,
                      pollSeconds: Number(event.target.value),
                    },
                  })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
            <Row label="最新バージョン" hint={update?.releasedAt ?? undefined}>
              <span
                className={`text-[11px] ${
                  update?.hasUpdate
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {update?.latestVersion
                  ? `v${update.latestVersion}`
                  : "—"}
              </span>
            </Row>
            {update?.notes && (
              <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                {update.notes}
              </p>
            )}
            {update?.manifestPath && (
              <p
                title={update.manifestPath}
                className="truncate text-[10px] text-[var(--text-muted)]"
              >
                情報: {update.manifestPath}
              </p>
            )}
            {update?.error && (
              <p className="text-[10px] text-[var(--error)]">
                {update.error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void updateStore.refresh()}
                className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
              >
                <RefreshCw size={10} /> 再確認
              </button>
              <button
                type="button"
                onClick={() => void launchUpdateInstaller()}
                disabled={!update?.hasUpdate || !update.installerPath}
                title={
                  update?.installerPath
                    ? update.installerPath
                    : "インストーラがありません"
                }
                className="flex items-center gap-1 rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                <ArrowUpCircle size={10} /> インストーラを起動
              </button>
              <button
                type="button"
                onClick={() => void openUpdateDir()}
                disabled={!update?.updateDir}
                className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-40"
              >
                <FolderOpen size={10} /> フォルダを開く
              </button>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
              指定した更新元フォルダを優先して確認し、未設定なら exe 隣接フォルダと
              D:\プログラミング\AI_Project\JARVIS\updates を確認します。
              変更は保存後に反映されます。
            </p>
          </Section>

          {message && (
            <p className="flex items-center gap-1 text-[11px] text-[var(--accent)]">
              <Check size={11} /> {message}
            </p>
          )}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-md border border-[var(--accent-dim)] bg-[var(--accent-dim)]/30 px-3 py-1.5 text-[11px] text-[var(--accent)] transition hover:bg-[var(--accent-dim)]/50 disabled:opacity-50"
          >
            保存
          </button>
        </footer>
      </div>
      {enrolling && (
        <WakeEnrollDialog
          threshold={draft.stt.threshold}
          inputDeviceId={draft.stt.inputDeviceId}
          onComplete={(samples) => void finishWakeEnrollment(samples)}
          onCancel={cancelWakeEnrollment}
        />
      )}
      <VoiceLabDialog
        open={voiceLabOpen}
        onClose={() => setVoiceLabOpen(false)}
      />
    </div>
  );
}
