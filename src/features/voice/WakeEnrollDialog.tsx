import { useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { MicRecorder } from "./recorder";
import type { RecordedAudio } from "./recorder";
import { speak, transcribeWakeSample } from "../../lib/ipc/voice";
import { logError } from "../../lib/logging";

const TOTAL_ROUNDS = 5;
const BAR_COUNT = 40;
const NUMERALS = ["１", "２", "３", "４", "５"];
const REMAINING = [
  "あと４回です。",
  "あと３回です。",
  "あとすこしです。",
  "次がラストです。",
];

const FIRST_PROMPT = "１回目の録音です。ジャービスと声をかけてください。";
const DONE_PROMPT = "記録が完了しました。お疲れ様です。";

function completionPrompt(round: number): string {
  return (
    `${NUMERALS[round]}回目の録音が完了しました。` +
    `${REMAINING[round]}ジャービスと声をかけてください。`
  );
}

type Phase = "speaking" | "listening" | "transcribing" | "done" | "error";

interface WakeEnrollDialogProps {
  threshold: number;
  onComplete: (samples: string[]) => void;
  onCancel: () => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function WakeEnrollDialog({
  threshold,
  onComplete,
  onCancel,
}: WakeEnrollDialogProps) {
  const [message, setMessage] = useState(FIRST_PROMPT);
  const [phase, setPhase] = useState<Phase>("speaking");
  const [levels, setLevels] = useState<number[]>([]);
  const [samples, setSamples] = useState<string[]>([]);
  const cancelledRef = useRef(false);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    cancelledRef.current = false;
    const collected: string[] = [];

    const announce = async (text: string) => {
      try {
        const payload = await speak(text);
        if (cancelledRef.current) return;
        await new Promise<void>((resolve) => {
          const audio = new Audio(
            `data:${payload.mime};base64,${payload.base64}`,
          );
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          void audio.play().catch(done);
          window.setTimeout(done, 15_000);
        });
      } catch (error) {
        void logError("wake_enroll_speak", error);
        await wait(1600);
      }
    };

    const recordRound = (): Promise<{
      audio: RecordedAudio | null;
      heardSpeech: boolean;
    }> => {
      const recorder = new MicRecorder();
      return recorder.start().then(
        () =>
          new Promise((resolve, reject) => {
            const startedAt = performance.now();
            let heardSpeech = false;
            let silenceAt: number | null = null;
            let finished = false;

            const finish = () => {
              if (finished) return;
              finished = true;
              window.clearInterval(timer);
              void recorder.stop().then(
                (audio) => resolve({ audio, heardSpeech }),
                (error) => reject(error),
              );
            };

            const timer = window.setInterval(() => {
              if (cancelledRef.current) {
                finish();
                return;
              }
              const level = recorder.level();
              setLevels((previous) => [
                ...previous.slice(-(BAR_COUNT - 1)),
                level,
              ]);
              const now = performance.now();
              if (level >= Math.max(0.006, threshold * 0.5)) {
                heardSpeech = true;
                silenceAt = null;
              } else if (heardSpeech) {
                silenceAt ??= now;
                if (now - silenceAt >= 700) finish();
              }
              if (now - startedAt >= 8000) finish();
            }, 60);
          }),
        (error) => {
          recorder.cancel();
          throw error;
        },
      );
    };

    const run = async () => {
      try {
        for (let round = 0; round < TOTAL_ROUNDS; round += 1) {
          if (cancelledRef.current) return;
          if (round === 0) {
            setMessage(FIRST_PROMPT);
            setPhase("speaking");
            await announce(FIRST_PROMPT);
            if (cancelledRef.current) return;
          }

          let attempts = 0;
          let saved = false;
          while (attempts < 3 && !saved) {
            if (cancelledRef.current) return;
            attempts += 1;
            setPhase("listening");
            setLevels([]);
            const captured = await recordRound();
            if (cancelledRef.current) return;

            if (!captured.audio || !captured.heardSpeech) {
              setMessage(
                `${NUMERALS[round]}回目: 声を検出できませんでした。` +
                  "もう一度ジャービスと声をかけてください。",
              );
              setPhase("speaking");
              await announce(
                "声が聞こえませんでした。もう一度ジャービスと声をかけてください。",
              );
              continue;
            }

            setPhase("transcribing");
            const transcript = (
              await transcribeWakeSample(captured.audio.base64, collected)
            ).trim();
            if (!transcript) {
              setMessage(
                `${NUMERALS[round]}回目: 聞き取れませんでした。` +
                  "もう一度ジャービスと声をかけてください。",
              );
              setPhase("speaking");
              await announce(
                "聞き取れませんでした。もう一度ジャービスと声をかけてください。",
              );
              continue;
            }

            collected.push(transcript);
            setSamples([...collected]);
            saved = true;

            if (round < TOTAL_ROUNDS - 1) {
              const nextPrompt = completionPrompt(round);
              setMessage(nextPrompt);
              setPhase("speaking");
              await announce(nextPrompt);
              if (cancelledRef.current) return;
            }
          }

          if (!saved) {
            setPhase("error");
            setMessage(
              "録音を完了できませんでした。マイクとwhisperの設定を確認してください。",
            );
            return;
          }
        }

        if (cancelledRef.current) return;
        setMessage(DONE_PROMPT);
        setPhase("done");
        await announce(DONE_PROMPT);
        if (cancelledRef.current) return;
        completedRef.current = true;
        onCompleteRef.current(collected);
      } catch (error) {
        void logError("wake_enroll", error);
        if (cancelledRef.current) return;
        setPhase("error");
        setMessage(`録音を開始できませんでした: ${String(error)}`);
      }
    };

    void run();
    return () => {
      cancelledRef.current = true;
    };
  }, [threshold]);

  const close = () => {
    cancelledRef.current = true;
    if (!completedRef.current) onCancelRef.current();
  };

  const peak = levels.reduce((max, level) => Math.max(max, level), 0);
  const phaseLabel =
    phase === "listening"
      ? "聞き取り中..."
      : phase === "transcribing"
        ? "文字起こし中..."
        : phase === "done"
          ? "完了"
          : phase === "error"
            ? "中断"
            : "読み上げ中...";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] p-5 shadow-2xl">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
            <Mic size={14} className="text-[var(--accent)]" />
            ウェイクワード登録
          </h3>
          <span className="text-[10px] text-[var(--text-muted)]">
            {phaseLabel}
          </span>
        </header>

        <div className="relative mb-4 flex h-24 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
          <div className="flex h-16 items-center gap-[3px]">
            {Array.from({ length: BAR_COUNT }).map((_, index) => {
              const level = levels[levels.length - BAR_COUNT + index] ?? 0;
              const scale = Math.min(1, level * 14);
              const active = index >= BAR_COUNT - levels.length;
              return (
                <span
                  key={index}
                  className="w-[3px] rounded-full transition-[height] duration-75"
                  style={{
                    height: `${Math.max(3, scale * 64)}px`,
                    background: active
                      ? "var(--accent)"
                      : "var(--border-strong)",
                    opacity: active ? 0.85 : 0.45,
                  }}
                />
              );
            })}
          </div>
          <span className="absolute bottom-1 right-2 text-[9px] text-[var(--text-muted)]">
            {Math.round(peak * 100)}%
          </span>
        </div>

        <p className="min-h-[3.5rem] text-center text-[12px] leading-relaxed text-[var(--text-primary)]">
          {message}
        </p>

        <div className="mt-2 flex items-center justify-center gap-1">
          {Array.from({ length: TOTAL_ROUNDS }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 w-6 rounded-full ${
                index < samples.length
                  ? "bg-[var(--accent)]"
                  : index === samples.length && phase !== "done"
                    ? "bg-[var(--accent-dim)]"
                    : "bg-[var(--border-strong)]"
              }`}
            />
          ))}
        </div>

        {samples.length > 0 && (
          <p className="mt-2 truncate text-center text-[10px] text-[var(--text-muted)]">
            {samples.join(" / ")}
          </p>
        )}

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={close}
            className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--error)]"
          >
            <X size={10} /> 中断
          </button>
        </div>
      </div>
    </div>
  );
}
