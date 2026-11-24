import { useCallback, useEffect, useState } from "react";
import { PanelRight, Settings, Sparkles } from "lucide-react";
import ThreadList from "../features/chat/ThreadList";
import ChatPane from "../features/chat/ChatPane";
import InputBar from "../features/chat/InputBar";
import { useMockChat } from "../features/chat/useMockChat";
import { getAppInfo, toggleHud } from "../lib/ipc/app";
import type { AppInfo, Thread } from "../shared/types";

const INITIAL_THREADS: Thread[] = [
  {
    id: "t-1",
    title: "JARVIS 開発ロードマップ",
    updatedAt: Date.now() - 6 * 60_000,
    pinned: true,
  },
  {
    id: "t-2",
    title: "音声認識エンジンの比較",
    updatedAt: Date.now() - 52 * 60_000,
  },
  {
    id: "t-3",
    title: "Ollama のモデル選定",
    updatedAt: Date.now() - 5 * 3_600_000,
  },
];

let threadSeq = 0;

export default function AppShell() {
  const [threads, setThreads] = useState<Thread[]>(INITIAL_THREADS);
  const [activeId, setActiveId] = useState(INITIAL_THREADS[0].id);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const { messages, isStreaming, send } = useMockChat(activeId);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  const activeThread = threads.find((thread) => thread.id === activeId);

  const createThread = useCallback(() => {
    const id = `t-new-${Date.now()}-${threadSeq++}`;
    setThreads((prev) => [
      { id, title: "新しい会話", updatedAt: Date.now() },
      ...prev,
    ]);
    setActiveId(id);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--accent-dim)]"
          style={{ boxShadow: "var(--glow-accent)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-[0.18em]">
            J.A.R.V.I.S.
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Local AI Assistant · {appInfo ? `v${appInfo.version}` : "…"}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warn)] align-middle" />
            provider: 未接続（P1）
          </span>
          <button
            type="button"
            onClick={() => void toggleHud()}
            title="HUD を表示 / 非表示"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Sparkles size={14} />
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            title="インスペクタ"
            className={`rounded-md border p-1.5 transition ${
              inspectorOpen
                ? "border-[var(--accent-dim)] text-[var(--accent)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <PanelRight size={14} />
          </button>
          <button
            type="button"
            title="設定（P1で実装）"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ThreadList
          threads={threads}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={createThread}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
          <ChatPane
            title={activeThread?.title ?? "新しい会話"}
            messages={messages}
            isStreaming={isStreaming}
          />
          <InputBar disabled={isStreaming} onSend={send} />
        </div>

        {inspectorOpen && (
          <aside className="flex w-[232px] shrink-0 flex-col gap-3 border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
            <h3 className="text-[10px] tracking-[0.24em] text-[var(--text-muted)]">
              INSPECTOR
            </h3>

            <dl className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Provider</dt>
                <dd className="text-[var(--text-secondary)]">未接続</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Model</dt>
                <dd className="text-[var(--text-secondary)]">—</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Messages</dt>
                <dd className="text-[var(--text-secondary)]">
                  {messages.length}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Latency</dt>
                <dd className="text-[var(--text-secondary)]">—</dd>
              </div>
            </dl>

            <div className="mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
              <p className="mb-1 font-medium text-[var(--text-secondary)]">
                P1 で接続予定
              </p>
              <p>Gemini API（無料枠）→ Ollama</p>
              <p>フォールバック順は設定画面で変更</p>
            </div>

            <div className="mt-auto text-[10px] text-[var(--text-muted)]">
              <p>HUD: Ctrl + Alt + Space</p>
              <p>常駐: トレイアイコン</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
