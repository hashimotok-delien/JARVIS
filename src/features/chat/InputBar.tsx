import { useRef, useState } from "react";
import {
  FileAudio,
  ImagePlus,
  Mic,
  Monitor,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import type { HudState, Template } from "../../shared/types";
import { captureScreenImage, transcribeAudioFile } from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";

interface InputBarProps {
  disabled?: boolean;
  streaming?: boolean;
  voiceState: HudState;
  sttAvailable: boolean;
  sttDetail?: string;
  templates: Template[];
  onSend: (text: string, imageBase64?: string | null) => void;
  onToggleMic: () => void;
  onStop: () => void;
  onCommand: (raw: string) => void;
}

const COMMANDS = [
  "/help",
  "/new",
  "/summarize",
  "/digest",
  "/memory",
  "/clip",
  "/image",
  "/timer",
  "/export",
  "/t",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function InputBar({
  disabled,
  streaming,
  voiceState,
  sttAvailable,
  sttDetail,
  templates,
  onSend,
  onToggleMic,
  onStop,
  onCommand,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [image, setImage] = useState<{ data: string; label: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const resize = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 152)}px`;
  };

  const submit = () => {
    if (disabled || busy) return;
    const text = value.trim();
    if (!text && !image) return;

    if (text.startsWith("/")) {
      onCommand(text);
      setValue("");
      setImage(null);
      requestAnimationFrame(resize);
      return;
    }

    onSend(text || "この画像について説明してください。", image?.data ?? null);
    setValue("");
    setImage(null);
    requestAnimationFrame(resize);
  };

  const listening = voiceState === "listening";
  const thinking = voiceState === "thinking";

  const suggestions =
    value.startsWith("/") && !value.includes(" ")
      ? [
          ...COMMANDS.filter((command) => command.startsWith(value)),
          ...templates
            .map((template) => `/t ${template.name}`)
            .filter((command) => command.startsWith(value)),
        ].slice(0, 6)
      : [];

  const pickImage = async (file: File) => {
    try {
      const data = await fileToBase64(file);
      setImage({ data, label: file.name });
    } catch (error) {
      void logError("attach_image", error);
    }
  };

  const grabScreen = async () => {
    setBusy(true);
    try {
      const captured = await captureScreenImage();
      if (captured) {
        setImage({ data: captured.base64, label: "スクリーンショット" });
      }
    } catch (error) {
      void logError("capture_screen", error);
    } finally {
      setBusy(false);
    }
  };

  const transcribeFile = async (file: File) => {
    setBusy(true);
    try {
      const data = await fileToBase64(file);
      const text = (await transcribeAudioFile(data)).trim();
      if (text) {
        setValue((current) => (current ? `${current}\n${text}` : text));
        requestAnimationFrame(resize);
      }
    } catch (error) {
      void logError("transcribe_file", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-3">
      <div className="relative mx-auto max-w-3xl">
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full left-2 mb-1 w-64 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-lg">
            {suggestions.map((command) => (
              <li key={command}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setValue(command.endsWith(" ") ? command : `${command} `);
                    textareaRef.current?.focus();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
                >
                  {command}
                </button>
              </li>
            ))}
          </ul>
        )}

        {image && (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-[var(--accent-dim)] bg-[var(--bg-elevated)] px-2 py-1.5">
            <img
              src={`data:image/png;base64,${image.data}`}
              alt=""
              className="h-10 w-10 rounded border border-[var(--border-subtle)] object-cover"
            />
            <span className="flex-1 truncate text-[10px] text-[var(--text-secondary)]">
              {image.label} を添付（Vision対応モデルのみ有効）
            </span>
            <button
              type="button"
              onClick={() => setImage(null)}
              className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--error)]"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 py-2 transition focus-within:border-[var(--accent-dim)]">
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

          <span className="mb-1 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => imageInput.current?.click()}
              title="画像を添付"
              className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
            >
              <ImagePlus size={15} />
            </button>
            <button
              type="button"
              onClick={() => void grabScreen()}
              disabled={busy}
              title="画面をキャプチャして添付"
              className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Monitor size={15} />
            </button>
            <button
              type="button"
              onClick={() => audioInput.current?.click()}
              disabled={busy || !sttAvailable}
              title="音声ファイル(.wav)を文字起こし"
              className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <FileAudio size={15} />
            </button>
          </span>

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
                : "メッセージを入力…（/ でコマンド）"
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
              disabled={disabled || (!value.trim() && !image)}
              title="送信"
              className="mb-0.5 rounded-lg p-1.5 text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:opacity-50"
            >
              <SendHorizontal size={16} />
            </button>
          )}
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void pickImage(file);
            event.target.value = "";
          }}
        />
        <input
          ref={audioInput}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void transcribeFile(file);
            event.target.value = "";
          }}
        />

        <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span>
            Enter 送信 / Shift + Enter 改行 / <span className="text-[var(--accent)]">/</span>{" "}
            コマンド
            {!sttAvailable && sttDetail ? ` · ${sttDetail}` : ""}
          </span>
          <span>
            {thinking ? "思考中…" : "Ctrl + K 検索 / Ctrl + Alt + Q クイック"}
          </span>
        </div>
      </div>
    </div>
  );
}
