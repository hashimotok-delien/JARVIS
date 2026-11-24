import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpCircle,
  Check,
  FolderOpen,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import { settingsStore, useSettings } from "./settingsStore";
import { updateStore, useUpdate } from "../update/updateStore";
import {
  launchUpdateInstaller,
  openUpdateDir,
} from "../../lib/ipc/update";
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
    },
    systemPrompt: source.systemPrompt,
    temperature: source.temperature,
    maxHistory: source.maxHistory,
    tts: { ...source.tts },
    stt: { ...source.stt },
    hud: { ...source.hud },
    startMinimized: source.startMinimized,
  };
}

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
    setBusy(true);
    try {
      await settingsStore.save(draft);
      setMessage("保存しました");
    } catch (error) {
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
      setMessage(`接続テストに失敗: ${String(error)}`);
    } finally {
      setBusy(false);
    }
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
            <Row
              label="ハンズフリー（VAD 自動ターン交代）"
              hint="起動語: J.A.R.V.I.S.（ジャーヴィス）いるか？"
            >
              <Switch
                checked={draft.stt.handsFree}
                onChange={(handsFree) =>
                  patch({ stt: { ...draft.stt, handsFree } })
                }
              />
            </Row>
          </Section>

          <Section title="ウィンドウ">
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
              `updates/latest.json` に新バージョンを記述し、同じフォルダに
              インストーラを置くと更新できます。
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
