import { useEffect, useRef, useState } from "react";
import {
  FlaskConical,
  Mic,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { MicRecorder } from "./recorder";
import type { RecordedAudio } from "./recorder";
import { useSettings } from "../settings/settingsStore";
import {
  deleteVoiceTest,
  listVoiceTests,
  listWhisperModels,
  readVoiceTestAudio,
  runVoiceTest,
  saveVoiceTest,
  type VoiceTest,
  type WhisperModelInfo,
} from "../../lib/ipc/voiceLab";
import { logError } from "../../lib/logging";

interface VoiceLabDialogProps {
  open: boolean;
  onClose: () => void;
}

const INPUT =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] " +
  "px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none " +
  "focus:border-[var(--accent-dim)] select-text";

function formatDate(value: number): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function cerColor(cer: number): string {
  if (cer <= 0.1) return "text-[var(--ok)]";
  if (cer <= 0.25) return "text-[var(--warn)]";
  return "text-[var(--error)]";
}

export default function VoiceLabDialog({ open, onClose }: VoiceLabDialogProps) {
  const settings = useSettings();
  const recorder = useRef(new MicRecorder());
  const player = useRef<HTMLAudioElement | null>(null);
  const levelTimer = useRef<number | null>(null);

  const [tests, setTests] = useState<VoiceTest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [modelPath, setModelPath] = useState("");
  const [reference, setReference] = useState("");
  const [name, setName] = useState("");
  const [captured, setCaptured] = useState<RecordedAudio | null>(null);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const selected = tests.find((test) => test.id === selectedId) ?? null;

  const reload = async () => {
    const [items, whisperModels] = await Promise.all([
      listVoiceTests(),
      listWhisperModels(),
    ]);
    setTests(items);
    setModels(whisperModels);
    setSelectedId((current) => current ?? items[0]?.id ?? null);
  };

  useEffect(() => {
    if (!open) return;
    void reload();
    return () => {
      if (levelTimer.current !== null) {
        window.clearInterval(levelTimer.current);
        levelTimer.current = null;
      }
      recorder.current.cancel();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) =>
      current && tests.some((test) => test.id === current)
        ? current
        : tests[0]?.id ?? null,
    );
  }, [open, tests]);

  if (!open) return null;

  const startRecording = async () => {
    setNote(null);
    setCaptured(null);
    try {
      await recorder.current.start(settings?.stt.inputDeviceId);
      setRecording(true);
      levelTimer.current = window.setInterval(() => {
        setLevel(recorder.current.level());
      }, 80);
    } catch (error) {
      void logError("voice_lab_record", error);
      setNote(`録音を開始できません: ${String(error)}`);
    }
  };

  const stopRecording = async () => {
    if (levelTimer.current !== null) {
      window.clearInterval(levelTimer.current);
      levelTimer.current = null;
    }
    setLevel(0);
    setRecording(false);
    const audio = await recorder.current.stop();
    if (audio) setCaptured(audio);
    else setNote("録音が空でした");
  };

  const save = async () => {
    if (!captured) return;
    setBusy(true);
    try {
      const test = await saveVoiceTest(name, reference, captured.base64);
      setCaptured(null);
      setName("");
      setReference("");
      setSelectedId(test.id);
      await reload();
      setNote(`保存しました（${(test.durationMs / 1000).toFixed(1)}秒）`);
    } catch (error) {
      void logError("voice_lab_save", error);
      setNote(`保存に失敗しました: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const play = async (id: string) => {
    try {
      const base64 = await readVoiceTestAudio(id);
      player.current?.pause();
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      player.current = audio;
      await audio.play();
    } catch (error) {
      void logError("voice_lab_play", error);
      setNote(`再生できません: ${String(error)}`);
    }
  };

  const run = async (engine?: "speech" | "whisper") => {
    if (!selected) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await runVoiceTest(
        selected.id,
        engine,
        engine === "whisper" && modelPath ? modelPath : undefined,
      );
      await reload();
      setNote(
        result.error
          ? `失敗: ${result.error}`
          : `CER ${(result.cer * 100).toFixed(1)}% / ${result.elapsedMs}ms`,
      );
    } catch (error) {
      void logError("voice_lab_run", error);
      setNote(`認識に失敗しました: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <FlaskConical size={15} className="text-[var(--accent)]" />
          <h3 className="text-sm font-medium">音声テスト（録音・CER比較）</h3>
          <span className="text-[10px] text-[var(--text-muted)]">
            同じ録音でエンジン・モデル・前処理を比較できます
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex w-[360px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--border-subtle)] p-3">
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              ウェイクワードは使わず、ボタンで録音します。正解文を入れて保存すると
              CER（文字誤り率）で比較できます。
            </p>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="テスト名（例: 天気を聞く）"
              className={INPUT}
            />
            <textarea
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              rows={2}
              placeholder="正解の文章（例: 今日の天気を教えて）"
              className={`${INPUT} resize-none`}
            />

            <div className="flex items-center gap-2">
              {recording ? (
                <button
                  type="button"
                  onClick={() => void stopRecording()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--error)] px-2 py-1.5 text-[11px] text-[var(--error)]"
                >
                  <Square size={11} /> 録音停止
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--accent-dim)] px-2 py-1.5 text-[11px] text-[var(--accent)]"
                >
                  <Mic size={12} /> 録音開始
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!captured || busy}
                className="rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
              >
                保存
              </button>
            </div>

            {recording && (
              <div className="h-1.5 overflow-hidden rounded bg-[var(--bg-hover)]">
                <div
                  className="h-full bg-[var(--accent)] transition-[width]"
                  style={{ width: `${Math.min(100, level * 400)}%` }}
                />
              </div>
            )}
            {captured && (
              <p className="text-[10px] text-[var(--ok)]">
                録音済み: {(captured.durationMs / 1000).toFixed(1)}秒（保存を押してください）
              </p>
            )}

            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] tracking-[0.2em] text-[var(--text-muted)]">
                テスト一覧 ({tests.length})
              </span>
              <button
                type="button"
                onClick={() => void reload()}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
              >
                <RefreshCw size={11} />
              </button>
            </div>

            <div className="space-y-1">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className={`rounded-md border px-2 py-1.5 ${
                    selectedId === test.id
                      ? "border-[var(--accent-dim)] bg-[var(--bg-elevated)]"
                      : "border-[var(--border-subtle)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(test.id)}
                    className="block w-full text-left"
                  >
                    <span className="block truncate text-[11px] text-[var(--text-primary)]">
                      {test.name}
                    </span>
                    <span className="block text-[9px] text-[var(--text-muted)]">
                      {formatDate(test.createdAt)} ·{" "}
                      {(test.durationMs / 1000).toFixed(1)}s · {test.results.length}回
                    </span>
                  </button>
                  <div className="mt-1 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void play(test.id)}
                      className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                      title="再生"
                    >
                      <Play size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void deleteVoiceTest(test.id).then(reload);
                      }}
                      className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                      title="削除"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {!selected ? (
              <p className="py-10 text-center text-[11px] text-[var(--text-muted)]">
                録音を保存するか、一覧からテストを選択してください。
              </p>
            ) : (
              <>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
                  <p className="text-[10px] text-[var(--text-muted)]">正解文</p>
                  <p className="text-[12px] text-[var(--text-primary)] select-text">
                    {selected.reference || "（未入力）"}
                  </p>
                  <p className="mt-1 text-[9px] text-[var(--text-muted)]">
                    {selected.sampleRate} Hz · {(selected.durationMs / 1000).toFixed(1)}秒
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("speech")}
                    className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[11px] text-[var(--accent)] disabled:opacity-40"
                  >
                    speech で認識
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("whisper")}
                    className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[11px] text-[var(--accent)] disabled:opacity-40"
                  >
                    whisper で認識
                  </button>
                  <select
                    value={modelPath}
                    onChange={(event) => setModelPath(event.target.value)}
                    className="min-w-[180px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px]"
                  >
                    <option value="">（設定のモデル）</option>
                    {models.map((model) => (
                      <option key={model.path} value={model.path}>
                        {model.name} ({model.sizeMb}MB)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("whisper")}
                    className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
                  >
                    選択モデルで whisper
                  </button>
                </div>

                {note && (
                  <p className="text-[10px] text-[var(--accent)]">{note}</p>
                )}

                <div className="space-y-1.5">
                  {selected.results.length === 0 && (
                    <p className="py-4 text-center text-[10px] text-[var(--text-muted)]">
                      まだ認識結果がありません。
                    </p>
                  )}
                  {[...selected.results].reverse().map((result, index) => (
                    <div
                      key={`${result.createdAt}-${index}`}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2"
                    >
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="rounded border border-[var(--border-subtle)] px-1 text-[var(--text-secondary)]">
                          {result.engine}
                        </span>
                        <span className="truncate text-[var(--text-muted)]">
                          {result.model}
                        </span>
                        <span className={`ml-auto font-medium ${cerColor(result.cer)}`}>
                          CER {(result.cer * 100).toFixed(1)}%
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {result.elapsedMs}ms
                        </span>
                      </div>
                      <p
                        className={`mt-1 text-[12px] select-text ${
                          result.error
                            ? "text-[var(--error)]"
                            : "text-[var(--text-primary)]"
                        }`}
                      >
                        {result.error ?? (result.text || "（空）")}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2 text-[9px] text-[var(--text-muted)]">
          <span>
            CERは正解文に対する文字誤り率です。同じ録音で条件を1つずつ変えて比較してください。
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1 text-[10px] text-[var(--text-secondary)]"
          >
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}
