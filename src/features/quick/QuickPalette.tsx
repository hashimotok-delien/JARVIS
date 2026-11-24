import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CornerDownLeft, Zap } from "lucide-react";
import { createThread, sendMessage } from "../../lib/ipc/chat";
import {
  CHAT_DELTA,
  CHAT_DONE,
  CHAT_ERROR,
  QUICK_PROMPT,
  onEvent,
} from "../../lib/ipc/events";
import { isTauri } from "../../lib/ipc/app";
import { logError } from "../../lib/logging";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  QuickPromptEvent,
} from "../../shared/types";

const THREAD_KEY = "jarvis.quickThreadId";

export default function QuickPalette() {
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    void onEvent<ChatDeltaEvent>(CHAT_DELTA, (payload) => {
      if (payload.requestId !== requestRef.current) return;
      setAnswer((current) => current + payload.delta);
      setThinking(true);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatDoneEvent>(CHAT_DONE, (payload) => {
      if (payload.requestId !== requestRef.current) return;
      setAnswer(payload.content);
      setThinking(false);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatErrorEvent>(CHAT_ERROR, (payload) => {
      if (payload.requestId !== requestRef.current) return;
      setError(payload.error);
      setThinking(false);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<QuickPromptEvent>(QUICK_PROMPT, (payload) => {
      setValue(payload.text);
      setError(null);
      inputRef.current?.focus();
    }).then((unlisten) => unlisteners.push(unlisten));

    inputRef.current?.focus();
    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const hide = () => {
    if (isTauri) void getCurrentWindow().hide();
  };

  const submit = async () => {
    const text = value.trim();
    if (!text || thinking) return;
    setError(null);
    setAnswer("");
    setThinking(true);
    setValue("");

    try {
      let threadId = localStorage.getItem(THREAD_KEY);
      if (!threadId) {
        const thread = await createThread("⚡ クイック入力");
        if (!thread) throw new Error("スレッドを作成できません");
        threadId = thread.id;
        localStorage.setItem(THREAD_KEY, threadId);
      }
      const ack = await sendMessage(threadId, text);
      if (!ack) throw new Error("送信できません");
      requestRef.current = ack.requestId;
    } catch (failure) {
      void logError("quick_palette", failure);
      setError(String(failure));
      setThinking(false);
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-xl"
      style={{
        borderColor: "rgba(0, 229, 255, 0.25)",
        background:
          "linear-gradient(150deg, rgba(10,17,26,0.94) 0%, " +
          "rgba(6,10,16,0.9) 100%)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      <div
        data-tauri-drag-region
        className="h-3 w-full shrink-0 cursor-grab"
      />
      <div className="flex items-center gap-2 px-3 py-2">
        <Zap size={14} className="text-[var(--accent)]" />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="JARVIS に一言…（Enter で送信 / Esc で閉じる）"
          className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] select-text"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={thinking || !value.trim()}
          title="送信"
          className="rounded-md p-1 text-[var(--accent)] disabled:opacity-40"
        >
          <CornerDownLeft size={14} />
        </button>
      </div>

      {(answer || error || thinking) && (
        <div className="mx-3 mb-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2">
          {error ? (
            <p className="text-[11px] text-[var(--error)]">{error}</p>
          ) : answer ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)] select-text">
              {answer}
            </p>
          ) : (
            <p className="text-[11px] text-[var(--accent)]">思考中…</p>
          )}
        </div>
      )}
    </div>
  );
}
