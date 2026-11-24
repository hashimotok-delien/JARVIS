import { useSyncExternalStore } from "react";
import {
  createThread as createThreadCmd,
  deleteThread as deleteThreadCmd,
  exportThread as exportThreadCmd,
  listMessages,
  listThreads,
  renameThread as renameThreadCmd,
  sendMessage,
  setThreadPinned,
  stopGeneration,
} from "../../lib/ipc/chat";
import {
  CHAT_DELTA,
  CHAT_DONE,
  CHAT_ERROR,
  CHAT_PROVIDER,
  CHAT_TITLE,
  onEvent,
} from "../../lib/ipc/events";
import { isTauri } from "../../lib/ipc/app";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatProviderEvent,
  ChatTitleEvent,
  Thread,
} from "../../shared/types";

const MOCK_REPLY = [
  "はい、ボス。バックエンド未接続のプレビュー動作です。",
  "",
  "`npm run tauri dev` で起動すると、Gemini / Ollama と実際に",
  "会話でき、履歴も SQLite に保存されます。",
].join("\n");

export interface ChatSnapshot {
  threads: Thread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  ready: boolean;
  streaming: boolean;
  requestId: string | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  fallbackReason: string | null;
  error: string | null;
}

type Listener = () => void;

let seq = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

class ChatStore {
  private snapshot: ChatSnapshot = {
    threads: [],
    activeThreadId: null,
    messages: [],
    ready: false,
    streaming: false,
    requestId: null,
    provider: null,
    model: null,
    latencyMs: null,
    fallbackReason: null,
    error: null,
  };

  private listeners = new Set<Listener>();
  private initialized = false;
  private mockTimer: number | null = null;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChatSnapshot => this.snapshot;

  private patch(changes: Partial<ChatSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private patchMessage(
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    const messages = this.snapshot.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    );
    this.patch({ messages });
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    if (!isTauri) {
      this.seedPreview();
      return;
    }

    await this.registerEvents();
    await this.reloadThreads();
  }

  private async registerEvents() {
    await onEvent<ChatDeltaEvent>(CHAT_DELTA, (payload) => {
      this.patchMessage(payload.messageId, (message) => ({
        ...message,
        content: message.content + payload.delta,
        pending: true,
      }));
      this.patch({ streaming: true });
    });

    await onEvent<ChatProviderEvent>(CHAT_PROVIDER, (payload) => {
      this.patch({
        provider: payload.provider,
        model: payload.model,
        fallbackReason: payload.reason ?? null,
      });
    });

    await onEvent<ChatDoneEvent>(CHAT_DONE, (payload) => {
      this.patchMessage(payload.messageId, (message) => ({
        ...message,
        content: payload.content,
        provider: payload.provider,
        model: payload.model,
        pending: false,
      }));
      this.patch({
        streaming: false,
        requestId: null,
        latencyMs: payload.latencyMs,
        provider: payload.provider,
        model: payload.model,
        error: null,
      });
      void this.reloadThreads(false);
    });

    await onEvent<ChatErrorEvent>(CHAT_ERROR, (payload) => {
      this.patchMessage(payload.messageId, (message) => ({
        ...message,
        content: message.content || "",
        error: payload.error,
        pending: false,
      }));
      this.patch({
        streaming: false,
        requestId: null,
        error: payload.error,
      });
    });

    await onEvent<ChatTitleEvent>(CHAT_TITLE, (payload) => {
      this.patch({
        threads: this.snapshot.threads.map((thread) =>
          thread.id === payload.threadId
            ? { ...thread, title: payload.title }
            : thread,
        ),
      });
    });
  }

  private seedPreview() {
    const now = Date.now();
    const thread: Thread = {
      id: localId("thread"),
      title: "プレビュー会話",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    this.patch({
      threads: [thread],
      activeThreadId: thread.id,
      ready: true,
    });
  }

  async reloadThreads(selectMissing = true) {
    const threads = await listThreads();
    if (threads.length === 0) {
      const thread = await createThreadCmd("新しい会話");
      if (thread) {
        this.patch({
          threads: [thread],
          activeThreadId: thread.id,
          ready: true,
        });
        return;
      }
    }

    const activeId = this.snapshot.activeThreadId;
    const stillExists = threads.some((thread) => thread.id === activeId);
    const nextActive =
      activeId && stillExists
        ? activeId
        : selectMissing
          ? (threads[0]?.id ?? null)
          : activeId;

    this.patch({
      threads,
      ready: true,
      activeThreadId: nextActive,
    });

    if (nextActive && nextActive !== activeId) {
      await this.loadMessages(nextActive);
    }
  }

  async loadMessages(threadId: string) {
    const messages = await listMessages(threadId);
    this.patch({ messages });
  }

  async selectThread(threadId: string) {
    if (threadId === this.snapshot.activeThreadId) return;
    this.patch({
      activeThreadId: threadId,
      messages: [],
      error: null,
      latencyMs: null,
      fallbackReason: null,
    });
    if (isTauri) {
      await this.loadMessages(threadId);
    }
  }

  async createThread(): Promise<void> {
    const thread = await createThreadCmd("新しい会話");
    if (!thread) {
      const fallback: Thread = {
        id: localId("thread"),
        title: "新しい会話",
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.patch({
        threads: [fallback, ...this.snapshot.threads],
        activeThreadId: fallback.id,
        messages: [],
      });
      return;
    }
    this.patch({
      threads: [thread, ...this.snapshot.threads],
      activeThreadId: thread.id,
      messages: [],
    });
  }

  async removeThread(threadId: string) {
    await deleteThreadCmd(threadId);
    const previousActive = this.snapshot.activeThreadId;
    const threads = this.snapshot.threads.filter(
      (thread) => thread.id !== threadId,
    );
    const activeId =
      previousActive === threadId
        ? (threads[0]?.id ?? null)
        : previousActive;
    this.patch({
      threads,
      activeThreadId: activeId,
      messages: activeId === previousActive ? this.snapshot.messages : [],
    });
    if (activeId && activeId !== previousActive) {
      await this.loadMessages(activeId);
    }
    if (threads.length === 0) {
      await this.createThread();
    }
  }

  async renameThread(threadId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    await renameThreadCmd(threadId, trimmed);
    this.patch({
      threads: this.snapshot.threads.map((thread) =>
        thread.id === threadId ? { ...thread, title: trimmed } : thread,
      ),
    });
  }

  async togglePinned(threadId: string) {
    const target = this.snapshot.threads.find(
      (thread) => thread.id === threadId,
    );
    if (!target) return;
    const pinned = !target.pinned;
    await setThreadPinned(threadId, pinned);
    const threads = this.snapshot.threads
      .map((thread) =>
        thread.id === threadId ? { ...thread, pinned } : thread,
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
    this.patch({ threads });
  }

  async exportThread(
    threadId: string | null,
    format: "markdown" | "json",
  ): Promise<string | null> {
    if (!threadId || !isTauri) return null;
    try {
      return await exportThreadCmd(threadId, format);
    } catch (error) {
      this.patch({ error: String(error) });
      return null;
    }
  }

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    const threadId = this.snapshot.activeThreadId;
    if (!threadId) return;
    if (this.snapshot.streaming) return;

    if (!isTauri) {
      this.sendPreview(threadId, content);
      return;
    }

    this.patch({ error: null, streaming: true });

    try {
      const ack = await sendMessage(threadId, content);
      if (!ack) {
        this.patch({ streaming: false });
        return;
      }
      const assistant: ChatMessage = {
        id: ack.assistantId,
        threadId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      };
      this.patch({
        messages: [...this.snapshot.messages, ack.userMessage, assistant],
        requestId: ack.requestId,
      });
    } catch (error) {
      this.patch({
        streaming: false,
        requestId: null,
        error: String(error),
      });
    }
  }

  private sendPreview(threadId: string, content: string) {
    const userMessage: ChatMessage = {
      id: localId("msg"),
      threadId,
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const assistantId = localId("msg");
    const assistant: ChatMessage = {
      id: assistantId,
      threadId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      pending: true,
    };

    this.patch({
      messages: [...this.snapshot.messages, userMessage, assistant],
      streaming: true,
      provider: "preview",
      model: "mock",
    });

    let cursor = 0;
    if (this.mockTimer !== null) {
      window.clearInterval(this.mockTimer);
    }
    this.mockTimer = window.setInterval(() => {
      cursor = Math.min(MOCK_REPLY.length, cursor + 4);
      const done = cursor >= MOCK_REPLY.length;
      this.patchMessage(assistantId, (message) => ({
        ...message,
        content: MOCK_REPLY.slice(0, cursor),
        pending: !done,
      }));
      if (done) {
        if (this.mockTimer !== null) {
          window.clearInterval(this.mockTimer);
          this.mockTimer = null;
        }
        this.patch({ streaming: false, latencyMs: 0 });
      }
    }, 18);
  }

  async stop() {
    const requestId = this.snapshot.requestId;
    if (requestId && isTauri) {
      await stopGeneration(requestId);
    }
  }
}

export const chatStore = new ChatStore();

export function useChatStore(): ChatSnapshot {
  return useSyncExternalStore(
    chatStore.subscribe,
    chatStore.getSnapshot,
  );
}
