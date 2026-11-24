import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { ChatMessage } from "../../shared/types";

interface ChatPaneProps {
  title: string;
  messages: ChatMessage[];
  isStreaming: boolean;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tracking-wider ${
          isUser
            ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            : "border-[var(--accent-dim)] bg-[var(--accent-dim)] text-[var(--accent-bright)]"
        }`}
        style={isUser ? undefined : { boxShadow: "var(--glow-accent)" }}
      >
        {isUser ? "YOU" : "J"}
      </div>

      <div
        className={`max-w-[76%] rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed select-text ${
          isUser
            ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
            : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.content}
          {message.pending && <span className="jarvis-caret" />}
        </p>
      </div>
    </motion.div>
  );
}

export default function ChatPane({
  title,
  messages,
  isStreaming,
}: ChatPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
        <h2 className="truncate text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          P0 モック
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--accent-dim)] text-sm font-semibold text-[var(--accent)]"
              style={{ boxShadow: "var(--glow-accent)" }}
            >
              J
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              何でも聞いてください、ボス。
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
              P0 では UI の検証用にモック応答を返します。
              Enter で送信、Shift + Enter で改行です。
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={bottomRef} />
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
