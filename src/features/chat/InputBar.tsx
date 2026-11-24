import { useRef, useState } from "react";
import { Mic, SendHorizontal, Square } from "lucide-react";
import type { HudState } from "../../shared/types";

interface InputBarProps {
  disabled?: boolean;
  streaming?: boolean;
  voiceState: HudState;
  sttAvailable: boolean;
  sttDetail?: string;
  onSend: (text: string) => void;
  onToggleMic: () => void;
  onStop: () => void;
}

export default function InputBar({
  disabled,
  streaming,
  voiceState,
  sttAvailable,
  sttDetail,
  onSend,
  onToggleMic,
  onStop,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 152)}px`;
  };

  const submit = () => {
    if (disabled) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(resize);
  };

  const listening = voiceState === "listening";
  const thinking = voiceState === "thinking";

  return (
    <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 py-2 transition focus-within:border-[var(--accent-dim)]">
        <button
          type="button"
          onClick={onToggleMic}
          title={
            !sttAvailable
              ? (sttDetail ?? "音声入力は利用できません")
              : listening
                ? "聞き取りを停止"
                : "音声入力（Ctrl + Alt + Space）"
          }
          className={`mb-0.5 rounded-lg p-1.5 transition ${
            listening
              ? "bg-[var(--error)]/15 text-[var(--error)]"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
          }`}
        >
          {listening ? (
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--error)]/40" />
              <Mic size={16} className="relative" />
            </span>
          ) : (
            <Mic size={16} />
          )}
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            listening
              ? "聞き取り中…（話し終えると自動送信）"
              : "メッセージを入力…（Enter で送信）"
          }
          className="max-h-[152px] min-h-[26px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] select-text"
        />

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            title="生成を停止"
            className="mb-0.5 rounded-lg p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--error)]"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            title="送信"
            className="mb-0.5 rounded-lg p-1.5 text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:opacity-50"
          >
            <SendHorizontal size={16} />
          </button>
        )}
      </div>

      <div className="mx-auto mt-1.5 flex max-w-3xl items-center justify-between text-[10px] text-[var(--text-muted)]">
        <span>
          Enter 送信 / Shift + Enter 改行
          {!sttAvailable && sttDetail ? ` · ${sttDetail}` : ""}
        </span>
        <span>
          {thinking
            ? "思考中…"
            : "Ctrl + Alt + Space 音声入力 / Ctrl + Alt + H HUD"}
        </span>
      </div>
    </div>
  );
}
