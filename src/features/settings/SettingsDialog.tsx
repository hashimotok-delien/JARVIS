import { useEffect, useState, type ReactNode } from "react";
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
import { MicRecorder } from "../voice/recorder";
import { voiceEngine } from "../voice/voiceEngine";
import { transcribeWakeSample } from "../../lib/ipc/voice";
import { normalizeWakeText } from "../voice/wakeWord";
import type {
  ProviderCheck,
  ProviderId,
  Settings,
} from "../../shared/types";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Gemini（クラウド・無料枠）",
  ollama: "Ollama（ローカル）",
};

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

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
      <h4 className="mb-1 text-[10px] tracking-[0.22em] text-[var(--text-muted)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

async function captureWakePhrase(threshold: number) {
  const recorder = new MicRecorder();
  try {
    await recorder.start();
    return await new Promise<{
      audio: Awaited<ReturnType<MicRecorder["stop"]>>;
      heardSpeech: boolean;
    }>((resolve, reject) => {
      const startedAt = performance.now();
      let heardSpeech = false;
      let silenceAt: number | null = null;
      let finished = false;
      const timer = window.setInterval(() => {
        const now = performance.now();
        if (recorder.level() >= Math.max(0.006, threshold * 0.5)) {
          heardSpeech = true;
          silenceAt = null;
        } else if (heardSpeech) {
          silenceAt ??= now;
          if (now - silenceAt >= 600) finish();
        }
        if (now - startedAt >= 8000) finish();
      }, 50);

      function finish() {
        if (finished) return;
        finished = true;
        window.clearInterval(timer);
        void recorder.stop().then(
          (audio) => resolve({ audio, heardSpeech }),
          reject,
        );
      }
    });
  } catch (error) {
    recorder.cancel();
    throw error;
  }
}

async function measureNoiseFloor(): Promise<number[]> {
  const recorder = new MicRecorder();
  try {
    await recorder.start();
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
  const [checks, setChecks] = useState<ProviderCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recordingWake, setRecordingWake] = useState(false);
  const [calibratingThreshold, setCalibratingThreshold] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = settingsStore.get();
    if (current) {
      setDraft(toDraft(current));
      setApiKey("");
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

  const MAX_WAKE = 5;

  /**
   * Record `count` separate attempts. Each attempt is its own recording,
   * and the working list keeps growing (fixes the old "always 1/5" bug).
   */
  const recordWakeSamples = async (count: number) => {
    if (!settings?.sttAvailable) {
      setMessage("whisper.cpp とモデルを設定してから登録してください");
      return;
    }
    if (draft.stt.wakeSamples.length >= MAX_WAKE) {
      setMessage("登録できる呼びかけ例は5件までです");
      return;
    }
    if (!voiceEngine.pauseForEnrollment()) {
      setMessage("音声処理が終わってから登録してください");
      return;
    }

    setBusy(true);
    setRecordingWake(true);
    let samples = [...draft.stt.wakeSamples];
    let step = 0;
    let attempts = 0;
    try {
      while (step < count && samples.length < MAX_WAKE) {
        if (attempts >= 12) {
          setMessage("登録を中断しました。もう一度お試しください");
          break;
        }
        attempts += 1;
        const next = samples.length + 1;
        setMessage(
          `${next}回目: 「ジャービス」と呼びかけてください（${samples.length}/${MAX_WAKE} 登録済み）`,
        );
        await new Promise((resolve) => window.setTimeout(resolve, 700));

        const captured = await captureWakePhrase(draft.stt.threshold);
        if (!captured.audio || !captured.heardSpeech) {
          setMessage(`${next}回目: 声を検出できませんでした。もう一度お試しください`);
          continue;
        }
        const transcript = (
          await transcribeWakeSample(captured.audio.base64, samples)
        ).trim();
        if (!transcript) {
          setMessage(`${next}回目: 呼びかけを文字起こしできませんでした`);
          continue;
        }
        if (
          samples.some(
            (sample) => normalizeWakeText(sample) === normalizeWakeText(transcript),
          )
        ) {
          setMessage(`「${transcript}」は登録済みです。別の言い方でどうぞ`);
          continue;
        }

        samples = [...samples, transcript].slice(0, MAX_WAKE);
        setDraft((current) =>
          current
            ? { ...current, stt: { ...current.stt, wakeSamples: [...samples] } }
            : current,
        );
        setMessage(`${samples.length}/${MAX_WAKE} 登録: ${transcript}`);
        step += 1;
      }
    } catch (error) {
      void logError("record_wake_sample", error);
      setMessage(`呼びかけ例を登録できませんでした: ${String(error)}`);
    } finally {
      voiceEngine.resumeAfterEnrollment();
      setBusy(false);
      setRecordingWake(false);
    }
  };

  const recordWakeSample = () => recordWakeSamples(1);
  const recordWakeBatch = () => recordWakeSamples(MAX_WAKE);

  const autoTuneThreshold = async () => {
    if (!voiceEngine.pauseForEnrollment()) {
      setMessage("音声処理が終わってから校正してください");
      return;
    }

    setBusy(true);
    setCalibratingThreshold(true);
    try {
      const levels = await measureNoiseFloor();
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
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-2xl">
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Section title="プロバイダ / フォールバック順">
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
                </span>
              </div>
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

          <Section title="会話">
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

          <Section title="音声出力（TTS）">
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

          <Section title="音声入力（STT / whisper.cpp）">
            <Row label="音声入力">
              <Switch
                checked={draft.stt.enabled}
                onChange={(enabled) =>
                  patch({ stt: { ...draft.stt, enabled } })
                }
              />
            </Row>
            <Row
              label="whisper-cli.exe"
              hint={settings?.sttAvailable ? "検出済み" : "未検出"}
            >
              <input
                value={draft.stt.whisperPath}
                onChange={(event) =>
                  patch({
                    stt: { ...draft.stt, whisperPath: event.target.value },
                  })
                }
                placeholder="C:\\tools\\whisper\\whisper-cli.exe"
                className={INPUT_CLASS}
              />
            </Row>
            <Row label="ggml モデル">
              <input
                value={draft.stt.modelPath}
                onChange={(event) =>
                  patch({
                    stt: { ...draft.stt, modelPath: event.target.value },
                  })
                }
                placeholder="C:\\tools\\whisper\\ggml-small.bin"
                className={INPUT_CLASS}
              />
            </Row>
            <Row label="言語">
              <input
                value={draft.stt.language}
                onChange={(event) =>
                  patch({ stt: { ...draft.stt, language: event.target.value } })
                }
                className={`${INPUT_CLASS} w-[90px]`}
              />
            </Row>
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
                「ジャービス」と呼びかける録音を1回ずつ、または5回まとめて
                行います。録音ごとに1件ずつ登録され、音声は保存せず文字起こし
                だけを端末内に保存します。
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--text-secondary)]">
                  登録数: {draft.stt.wakeSamples.length}/5
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void recordWakeSample()}
                    disabled={
                      busy ||
                      !settings?.sttAvailable ||
                      draft.stt.wakeSamples.length >= 5
                    }
                    className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-40"
                  >
                    {recordingWake ? "録音中..." : "1回録音"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void recordWakeBatch()}
                    disabled={
                      busy ||
                      !settings?.sttAvailable ||
                      draft.stt.wakeSamples.length >= 5
                    }
                    className="shrink-0 rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
                  >
                    {recordingWake
                      ? "録音中..."
                      : `5回まとめて録音 (${draft.stt.wakeSamples.length}/5)`}
                  </button>
                </span>
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

          <Section title="ツール実行（Function Calling）">
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

          <Section title="長期記憶">
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

          <Section title="表示 / クリップボード">
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

          <Section title="データ">
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

          <Section title="ウィンドウ">
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
            <div className="flex justify-end pb-2">
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
            <Row label="起動時に最小化（トレイ常駐）">
              <Switch
                checked={draft.startMinimized}
                onChange={(startMinimized) => patch({ startMinimized })}
              />
            </Row>
          </Section>

          <Section title="アップデート">
            <Row label="現在のバージョン">
              <span className="text-[11px] text-[var(--text-secondary)]">
                v{update?.currentVersion ?? "—"}
              </span>
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
              exe隣接フォルダと
              D:\プログラミング\AI_Project\JARVIS\updates の
              latest.json およびインストーラを確認します。
            </p>
          </Section>

          {message && (
            <p className="flex items-center gap-1 text-[11px] text-[var(--accent)]">
              <Check size={11} /> {message}
            </p>
          )}
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
    </div>
  );
}
