import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/types";

const MOCK_REPLY = [
  "はい、ボス。P0 フェーズのUIモックが稼働しています。",
  "",
  "いまはフロントエンドのみの応答で、モデル接続は P1 で行います:",
  "1. Gemini API（無料枠）で疎通確認",
  "2. Ollama（qwen2.5:7b-instruct）を追加",
  "",
  "HUD は Ctrl + Alt + Space で切り替えられます。",
].join("\n");

let seq = 0;
const nextId = () => `msg-${Date.now()}-${seq++}`;

export function useMockChat(threadId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    stop();
    setMessages([]);
    return stop;
  }, [threadId, stop]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || timerRef.current !== null) {
        return;
      }

      const userMessage: ChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const assistantId = nextId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      let cursor = 0;
      timerRef.current = window.setInterval(() => {
        cursor = Math.min(MOCK_REPLY.length, cursor + 3);
        const chunk = MOCK_REPLY.slice(0, cursor);
        const done = cursor >= MOCK_REPLY.length;

        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: chunk, pending: !done }
              : message,
          ),
        );

        if (done) {
          stop();
        }
      }, 18);
    },
    [stop],
  );

  return { messages, isStreaming, send };
}
