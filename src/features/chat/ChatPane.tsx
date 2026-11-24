import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  GitBranch,
  Pencil,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import MarkdownText from "../../shared/MarkdownText";
import type { ChatMessage } from "../../shared/types";
import { writeClipboardText } from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";

interface ChatPaneProps {
  title: string;
  preferredName: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  onStop: () => void;
  onRegenerate: () => void;
  onEdit: (messageId: string, text: string) => void;
  onBranch: (messageId: string) => void;
}

function MessageBubble({
  message,
  isLast,
  onRegenerate,
  onEdit,
  onBranch,
}: {
  message: ChatMessage;
  isLast: boolean;
  onRegenerate: () => void;
  onEdit: (messageId: string, text: string) => void;
  onBranch: (messageId: string) => void;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else {
        await writeClipboardText(message.content);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      void logError("copy_message", error);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tracking-wider ${
          isUser
            ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            : "border-[var(--accent-dim)] bg-[var(--accent-dim)] text-[var(--accent-bright)]"
        }`}
        style={isUser ? undefined : { boxShadow: "var(--glow-accent)" }}
      >
        {isUser ? (
          "YOU"
        ) : (
          <img
            src="/jarvis.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full rounded-full object-cover"
          />
        )}
      </div>

      <div
        className={`flex max-w-[78%] flex-col ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed select-text ${
            isUser
              ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)]"
          }`}
        >
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={Math.min(8, draft.split("\n").length + 1)}
                className="w-full resize-none rounded-md border border-[var(--accent-dim)] bg-[var(--bg-base)] px-2 py-1 text-[13px] text-[var(--text-primary)] outline-none select-text"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                  }}
                  className="rounded border border-[var(--border-strong)] p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    onEdit(message.id, draft.trim());
                  }}
                  disabled={!draft.trim()}
                  className="rounded border border-[var(--accent-dim)] p-1 text-[var(--accent)] disabled:opacity-40"
                >
                  <Check size={12} />
                </button>
              </div>
            </div>
          ) : (
            <MarkdownText text={message.content} />
          )}
          {message.pending && <span className="jarvis-caret" />}
          {message.error && (
            <p className="mt-1 border-t border-[var(--error)]/30 pt-1 text-[11px] text-[var(--error)]">
              {message.error}
            </p>
          )}
          {!isUser && message.provider && (
            <p className="mt-1.5 text-[9px] tracking-wide text-[var(--text-muted)]">
              {message.provider}
              {message.model ? ` · ${message.model}` : ""}
            </p>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            title="コピー"
            className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
          {isUser && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="編集して再送"
              className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              <Pencil size={11} />
            </button>
          )}
          {!isUser && isLast && !message.pending && (
            <button
              type="button"
              onClick={onRegenerate}
              title="再生成"
              className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              <RefreshCw size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onBranch(message.id)}
            title="ここから分岐"
            className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            <GitBranch size={11} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function ChatPane({
  title,
  preferredName,
  messages,
  isStreaming,
  provider,
  model,
  latencyMs,
  onStop,
  onRegenerate,
  onEdit,
  onBranch,
}: ChatPaneProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    if (isStreaming) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [isStreaming, messages]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
        <h2 className="truncate text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {provider ?? "未接続"}
          {model ? ` · ${model}` : ""}
        </span>
        {latencyMs !== null && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {(latencyMs / 1000).toFixed(2)}s
          </span>
        )}
        {isStreaming && (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--error)] hover:text-[var(--error)]"
          >
            <Square size={9} /> 停止
          </button>
        )}
      </header>

      <div
        ref={messagesRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <img
              src="/jarvis.png"
              alt="J.A.R.V.I.S."
              className="h-12 w-12 rounded-lg border border-[var(--accent-dim)] object-cover"
              style={{ boxShadow: "var(--glow-accent)" }}
            />
            <p className="text-sm text-[var(--text-secondary)]">
              何でも聞いてください、{preferredName}。
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
              Enter で送信 / Shift + Enter で改行。
              <br />
              マイクボタンか Ctrl + Alt + Space で音声入力。
              <br />
              Ctrl + K で全文検索 / Ctrl + Alt + Q でクイック入力。
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isLast={message.id === lastAssistantId}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onBranch={onBranch}
              />
            ))}
          </div>
        )}
      </div>

      {isStreaming && (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-5 py-1.5 text-[10px] text-[var(--accent)]">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1 w-1 rounded-full bg-current"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.1,
                  delay: i * 0.16,
                }}
              />
            ))}
          </span>
          応答を生成中
        </div>
      )}
    </section>
  );
}
