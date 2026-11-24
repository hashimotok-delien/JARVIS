import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
  PanelRight,
  Settings as SettingsIcon,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import ThreadList from "../features/chat/ThreadList";
import ChatPane from "../features/chat/ChatPane";
import InputBar from "../features/chat/InputBar";
import { chatStore, useChatStore } from "../features/chat/chatStore";
import SettingsDialog from "../features/settings/SettingsDialog";
import { useSettings } from "../features/settings/settingsStore";
import { voiceEngine, useVoiceStatus } from "../features/voice/voiceEngine";
import { updateStore, useUpdate } from "../features/update/updateStore";
import { getAppInfo, toggleHud } from "../lib/ipc/app";
import { toggleMute } from "../lib/ipc/settings";
import type { AppInfo } from "../shared/types";

export default function AppShell() {
  const chat = useChatStore();
  const settings = useSettings();
  const voiceState = useVoiceStatus();
  const update = useUpdate();

  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [seenPreviousVersion, setSeenPreviousVersion] = useState(false);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
    void chatStore.init();
    void voiceEngine.init();
    void updateStore.refresh();
  }, []);

  // Announce a successful upgrade once per launch.
  useEffect(() => {
    if (seenPreviousVersion || !settings?.previousVersion) return;
    setSeenPreviousVersion(true);
    setToast(
      `v${settings.previousVersion} から v${appInfo?.version ?? ""} に更新されました`,
    );
  }, [settings?.previousVersion, appInfo?.version, seenPreviousVersion]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeThread = useMemo(
    () =>
      chat.threads.find(
        (thread) => thread.id === chat.activeThreadId,
      ) ?? null,
    [chat.threads, chat.activeThreadId],
  );

  const muted = settings ? !settings.tts.enabled : false;

  const handleExport = async (
    threadId: string,
    format: "markdown" | "json",
  ) => {
    const path = await chatStore.exportThread(threadId, format);
    if (path) {
      setToast(`書き出しました: ${path}`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <img
          src="/jarvis.png"
          alt=""
          aria-hidden="true"
          className="h-7 w-7 rounded-md border border-[var(--accent-dim)] object-cover"
          style={{ boxShadow: "var(--glow-accent)" }}
        />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-[0.18em]">
            J.A.R.V.I.S.
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Local AI Assistant ·{" "}
            {appInfo ? `v${appInfo.version}` : "…"}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {update?.hasUpdate && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={`新しいバージョン ${update.latestVersion} が利用できます`}
              className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/50 bg-[var(--accent-dim)]/30 px-2.5 py-1 text-[10px] text-[var(--accent)] transition hover:bg-[var(--accent-dim)]/50"
            >
              <ArrowUpCircle size={12} /> 更新 v{update.latestVersion}
            </button>
          )}
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                chat.provider
                  ? "bg-[var(--ok)]"
                  : "bg-[var(--text-muted)]"
              }`}
            />
            {chat.provider
              ? `${chat.provider}${chat.model ? ` · ${chat.model}` : ""}`
              : "未接続"}
          </span>

          <button
            type="button"
            onClick={async () => {
              const enabled = await toggleMute();
              setToast(
                enabled ? "読み上げを有効にしました" : "ミュート中",
              );
            }}
            title={muted ? "ミュート解除" : "ミュート"}
            className={`rounded-md border p-1.5 transition ${
              muted
                ? "border-[var(--warn)]/60 text-[var(--warn)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
            }`}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <button
            type="button"
            onClick={() => void toggleHud()}
            title="HUD を表示 / 非表示（Ctrl + Alt + H）"
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
            onClick={() => setSettingsOpen(true)}
            title="設定"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ThreadList
          threads={chat.threads}
          activeId={chat.activeThreadId}
          onSelect={(id) => void chatStore.selectThread(id)}
          onCreate={() => void chatStore.createThread()}
          onRename={(id, title) => void chatStore.renameThread(id, title)}
          onTogglePin={(id) => void chatStore.togglePinned(id)}
          onDelete={(id) => {
            if (window.confirm("このスレッドを削除しますか？")) {
              void chatStore.removeThread(id);
            }
          }}
          onExport={(id, format) => void handleExport(id, format)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
          <ChatPane
            title={activeThread?.title ?? "新しい会話"}
            preferredName={settings?.preferredName ?? "ボス"}
            messages={chat.messages}
            isStreaming={chat.streaming}
            provider={chat.provider}
            model={chat.model}
            latencyMs={chat.latencyMs}
            onStop={() => void chatStore.stop()}
          />
          <InputBar
            disabled={chat.streaming}
            streaming={chat.streaming}
            voiceState={voiceState}
            sttAvailable={settings?.sttAvailable ?? false}
            sttDetail={settings?.sttDetail}
            onSend={(text) => {
              voiceEngine.stopSpeaking();
              void chatStore.send(text);
            }}
            onToggleMic={() => void voiceEngine.toggle()}
            onStop={() => void chatStore.stop()}
          />
        </div>

        {inspectorOpen && (
          <aside className="flex w-[232px] shrink-0 flex-col gap-3 border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
            <h3 className="text-[10px] tracking-[0.24em] text-[var(--text-muted)]">
              INSPECTOR
            </h3>

            <dl className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Provider</dt>
                <dd className="text-[var(--text-secondary)]">
                  {chat.provider ?? "未接続"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Model</dt>
                <dd className="max-w-[130px] truncate text-[var(--text-secondary)]">
                  {chat.model ?? "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Messages</dt>
                <dd className="text-[var(--text-secondary)]">
                  {chat.messages.length}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Latency</dt>
                <dd className="text-[var(--text-secondary)]">
                  {chat.latencyMs !== null
                    ? `${(chat.latencyMs / 1000).toFixed(2)}s`
                    : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--text-muted)]">Voice</dt>
                <dd className="text-[var(--text-secondary)]">
                  {voiceState}
                </dd>
              </div>
            </dl>

            {chat.fallbackReason && (
              <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-2.5 text-[10px] leading-relaxed text-[var(--warn)]">
                フォールバック: {chat.fallbackReason}
              </div>
            )}

            <div className="mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
              <p className="mb-1 font-medium text-[var(--text-secondary)]">
                Provider 順序
              </p>
              <p>
                {(settings?.providers.order ?? ["gemini", "ollama"]).join(
                  " → ",
                )}
              </p>
              <p className="mt-1.5">
                STT:{" "}
                {settings
                  ? settings.sttAvailable
                    ? settings.sttDetail
                    : "未設定"
                  : "—"}
              </p>
              <p className="mt-1">
                TTS: {settings?.tts.engine ?? "—"} /{" "}
                {muted ? "ミュート" : "有効"}
              </p>
            </div>

            <div className="mt-auto text-[10px] text-[var(--text-muted)]">
              <p>音声入力: Ctrl + Alt + Space</p>
              <p>HUD: Ctrl + Alt + H</p>
              <p>常駐: トレイアイコン</p>
            </div>
          </aside>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--accent-dim)] bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--text-secondary)] shadow-lg">
          {toast}
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
