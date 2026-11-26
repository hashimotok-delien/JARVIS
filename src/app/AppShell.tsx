import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  Brain,
  PanelRight,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import ThreadList from "../features/chat/ThreadList";
import ChatPane from "../features/chat/ChatPane";
import InputBar from "../features/chat/InputBar";
import SearchOverlay from "../features/chat/SearchOverlay";
import { chatStore, useChatStore } from "../features/chat/chatStore";
import SettingsDialog from "../features/settings/SettingsDialog";
import MemoryDialog from "../features/memory/MemoryDialog";
import ApprovalDialog from "../features/tools/ApprovalDialog";
import { useSettings } from "../features/settings/settingsStore";
import { voiceEngine, useVoiceStatus } from "../features/voice/voiceEngine";
import { updateStore, useUpdate } from "../features/update/updateStore";
import { getAppInfo, toggleHud } from "../lib/ipc/app";
import { toggleMute } from "../lib/ipc/settings";
import {
  addMemory,
  captureScreenImage,
  dailyDigest,
  exportAll,
  listTemplates,
  readClipboardText,
  resolveToolApproval,
  setTimerNow,
  showQuickPalette,
  summarizeThread,
  usageStats,
} from "../lib/ipc/assistant";
import {
  CHAT_DONE,
  MEMORY_UPDATED,
  TIMER_FIRED,
  TOOL_APPROVAL,
  TOOL_STATUS,
  onEvent,
} from "../lib/ipc/events";
import { logError } from "../lib/logging";
import { applyHudTheme } from "../shared/theme/palette";
import type {
  AppInfo,
  SearchHit,
  Template,
  TimerFiredEvent,
  ToolApprovalEvent,
  ToolStatusEvent,
  UsageStats,
} from "../shared/types";

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

const HELP_TEXT =
  "/help コマンド一覧 ・ /new 新規 ・ /summarize 要約 ・ /digest 振り返り ・ " +
  "/memory 記憶 ・ /clip クリップボード要約 ・ /image 画面を解析 ・ " +
  "/timer 分 ・ /export 全書き出し ・ /t 名前 テンプレート";

export default function AppShell() {
  const chat = useChatStore();
  const settings = useSettings();
  const voiceState = useVoiceStatus();
  const update = useUpdate();

  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [approval, setApproval] = useState<ToolApprovalEvent | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [seenPreviousVersion, setSeenPreviousVersion] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const toolTimer = useRef<number | null>(null);
  const clipboardRef = useRef("");

  const refreshAux = useCallback(async () => {
    try {
      const [templateList, stats] = await Promise.all([
        listTemplates(),
        usageStats(),
      ]);
      setTemplates(templateList);
      setUsage(stats);
    } catch (error) {
      void logError("refresh_aux", error);
    }
  }, []);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
    void chatStore.init();
    void voiceEngine.init();
    void updateStore.refresh();
    updateStore.startWatching();
    void refreshAux();
  }, [refreshAux]);

  // Apply theme and font scale.
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.ui.theme;
    document.documentElement.style.setProperty(
      "--font-scale",
      String(settings.ui.fontScale),
    );
    applyHudTheme(settings.ui);
  }, [settings]);

  useEffect(() => {
    if (seenPreviousVersion || !settings?.previousVersion) return;
    setSeenPreviousVersion(true);
    setToast({
      text: `v${settings.previousVersion} から v${appInfo?.version ?? ""} に更新されました`,
    });
  }, [settings?.previousVersion, appInfo?.version, seenPreviousVersion]);

  // Let the voice engine answer a pending tool approval with yes/no.
  useEffect(() => {
    voiceEngine.setApproval(approval?.id ?? null);
  }, [approval]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Backend events: tool approvals, tool status, timers, memory.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    void onEvent<ToolApprovalEvent>(TOOL_APPROVAL, setApproval).then(
      (unlisten) => unlisteners.push(unlisten),
    );

    void onEvent<ToolStatusEvent>(TOOL_STATUS, (payload) => {
      const marks: Record<string, string> = {
        running: "実行中",
        ok: "完了",
        error: "失敗",
        denied: "拒否",
      };
      setToolStatus(`🔧 ${payload.name}: ${marks[payload.state] ?? payload.state}`);
      if (toolTimer.current !== null) window.clearTimeout(toolTimer.current);
      toolTimer.current = window.setTimeout(() => setToolStatus(null), 4000);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<TimerFiredEvent>(TIMER_FIRED, (payload) => {
      setToast({ text: `⏰ ${payload.label} の時間です` });
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<unknown>(MEMORY_UPDATED, (payload) => {
      void refreshAux();
      setToast({
        text:
          payload === "template"
            ? "テンプレートを更新しました"
            : "記憶を更新しました",
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<unknown>(CHAT_DONE, () => {
      void usageStats().then(setUsage).catch(() => undefined);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
      if (toolTimer.current !== null) window.clearTimeout(toolTimer.current);
    };
  }, [refreshAux]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (mod && event.shiftKey && key === "m") {
        event.preventDefault();
        setMemoryOpen(true);
      } else if (mod && key === "n") {
        event.preventDefault();
        void chatStore.createThread();
      } else if (mod && event.shiftKey && key === "q") {
        event.preventDefault();
        void showQuickPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Optional clipboard watcher.
  useEffect(() => {
    if (!settings?.ui.clipboardWatch) return;
    const timer = window.setInterval(() => {
      void readClipboardText()
        .then((text) => {
          const trimmed = text.trim();
          if (trimmed.length < 40 || clipboardRef.current === trimmed) return;
          clipboardRef.current = trimmed;
          setToast({
            text: "クリップボードのテキストを要約しますか？",
            action: {
              label: "要約",
              run: () => {
                void chatStore.send(
                  `次のテキストを要約してください:\n\n${trimmed}`,
                );
              },
            },
          });
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [settings?.ui.clipboardWatch]);

  const activeThread = useMemo(
    () =>
      chat.threads.find((thread) => thread.id === chat.activeThreadId) ?? null,
    [chat.threads, chat.activeThreadId],
  );

  const muted = settings ? !settings.tts.enabled : false;

  const handleExport = async (
    threadId: string,
    format: "markdown" | "json",
  ) => {
    const path = await chatStore.exportThread(threadId, format);
    if (path) setToast({ text: `書き出しました: ${path}` });
  };

  const runCommand = (raw: string) => {
    const [name, ...rest] = raw.trim().split(/\s+/);
    const argument = rest.join(" ").trim();
    const run = async () => {
      switch (name) {
        case "/help":
          setToast({ text: HELP_TEXT });
          break;
        case "/new":
          await chatStore.createThread();
          break;
        case "/summarize": {
          if (!chat.activeThreadId) break;
          const summary = await summarizeThread(chat.activeThreadId);
          setToast({ text: `要約: ${summary.slice(0, 160)}` });
          break;
        }
        case "/digest": {
          const digest = await dailyDigest();
          setToast({ text: digest.slice(0, 240) });
          break;
        }
        case "/memory": {
          if (!argument) {
            setMemoryOpen(true);
            break;
          }
          await addMemory(argument, "manual");
          setToast({ text: `記憶しました: ${argument}` });
          break;
        }
        case "/clip": {
          const text = (await readClipboardText()).trim();
          if (!text) {
            setToast({ text: "クリップボードは空です" });
            break;
          }
          await chatStore.send(`次のテキストを要約してください:\n\n${text}`);
          break;
        }
        case "/image": {
          const image = await captureScreenImage();
          if (image) {
            await chatStore.send(
              "この画面について、要点と気づいた点を教えてください。",
              image.base64,
            );
          }
          break;
        }
        case "/timer": {
          const minutes = Number.parseFloat(rest[0] ?? "");
          if (!Number.isFinite(minutes) || minutes <= 0) {
            setToast({ text: "使い方: /timer 10 休憩" });
            break;
          }
          await setTimerNow(minutes, rest.slice(1).join(" ") || "タイマー");
          setToast({ text: `${minutes} 分後に通知します` });
          break;
        }
        case "/export": {
          const path = await exportAll("markdown");
          setToast({ text: `書き出しました: ${path}` });
          break;
        }
        case "/t": {
          const template = templates.find(
            (item) => item.name.toLowerCase() === argument.toLowerCase(),
          );
          if (!template) {
            setToast({ text: `テンプレート「${argument}」が見つかりません` });
            break;
          }
          await chatStore.send(template.body);
          break;
        }
        default:
          setToast({
            text: `不明なコマンド: ${name}（/help で一覧）`,
          });
      }
    };

    void run().catch((error) => {
      void logError("slash_command", error);
      setToast({ text: `コマンド失敗: ${String(error)}` });
    });
  };

  const openSearchHit = (hit: SearchHit) => {
    void chatStore.selectThread(hit.threadId);
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
            Local AI Assistant · {appInfo ? `v${appInfo.version}` : "…"}
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
                chat.provider ? "bg-[var(--ok)]" : "bg-[var(--text-muted)]"
              }`}
            />
            {chat.provider
              ? `${chat.provider}${chat.model ? ` · ${chat.model}` : ""}`
              : "未接続"}
          </span>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="会話を検索（Ctrl + K）"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Search size={14} />
          </button>

          <button
            type="button"
            onClick={() => void showQuickPalette()}
            title="クイック入力（Ctrl + Alt + Q）"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Zap size={14} />
          </button>

          <button
            type="button"
            onClick={() => setMemoryOpen(true)}
            title="記憶とテンプレート（Ctrl + Shift + M）"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Brain size={14} />
          </button>

          <button
            type="button"
            onClick={async () => {
              const enabled = await toggleMute();
              setToast({
                text: enabled ? "読み上げを有効にしました" : "ミュート中",
              });
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
            onRegenerate={() => void chatStore.regenerate()}
            onEdit={(messageId, text) =>
              void chatStore.editAndResend(messageId, text)
            }
            onBranch={(messageId) => {
              void chatStore.branch(messageId).then((id) => {
                if (id) setToast({ text: "会話を分岐しました" });
              });
            }}
          />
          <InputBar
            disabled={chat.streaming}
            streaming={chat.streaming}
            voiceState={voiceState}
            sttAvailable={settings?.sttAvailable ?? false}
            sttDetail={settings?.sttDetail}
            templates={templates}
            onSend={(text, imageBase64) => {
              voiceEngine.stopSpeaking();
              void chatStore.send(text, imageBase64);
            }}
            onToggleMic={() => void voiceEngine.toggle()}
            onStop={() => void chatStore.stop()}
            onCommand={runCommand}
          />
        </div>

        {inspectorOpen && (
          <aside className="flex w-[244px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
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
                <dd className="text-[var(--text-secondary)]">{voiceState}</dd>
              </div>
            </dl>

            {toolStatus && (
              <div className="rounded-lg border border-[var(--accent-dim)] bg-[var(--accent-dim)]/20 px-2.5 py-1.5 text-[10px] text-[var(--accent)]">
                {toolStatus}
              </div>
            )}

            {chat.fallbackReason && (
              <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-2.5 text-[10px] leading-relaxed text-[var(--warn)]">
                フォールバック: {chat.fallbackReason}
              </div>
            )}

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
              <p className="mb-1 font-medium text-[var(--text-secondary)]">
                使用量（24時間 / 7日 / 累計）
              </p>
              <p>
                {usage
                  ? `${usage.today.requests} / ${usage.week.requests} / ${usage.all.requests} 回`
                  : "—"}
              </p>
              <p className="mt-1">
                {usage
                  ? `平均 ${Math.round(usage.today.avgLatencyMs)}ms · ${usage.today.characters.toLocaleString()} 文字`
                  : ""}
              </p>
              <p className="mt-0.5">
                {usage
                  ? `概算 ${Math.round(
                      usage.today.characters / 1.6,
                    ).toLocaleString()} トークン`
                  : ""}
              </p>
              {usage && usage.byProvider.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {usage.byProvider.slice(0, 4).map((item) => (
                    <li key={`${item.provider}-${item.model}`} className="truncate">
                      {item.provider}: {item.requests}回
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
              <p className="mb-1 font-medium text-[var(--text-secondary)]">
                Provider 順序
              </p>
              <p>
                {(settings?.providers.order ?? ["gemini", "ollama"]).join(
                  " → ",
                )}
                {settings?.providers.autoRoute ? "（自動振り分け）" : ""}
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
              <p className="mt-1">
                ツール: {settings?.tools.enabled ? "有効" : "無効"} · 記憶:{" "}
                {settings?.memory.enabled ? "有効" : "無効"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMemoryOpen(true)}
              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
            >
              記憶とテンプレートを開く
            </button>

            <div className="mt-auto text-[10px] text-[var(--text-muted)]">
              <p>Ctrl + K 検索 / Ctrl + N 新規</p>
              <p>Ctrl + Alt + Q クイック / Ctrl + Alt + S 選択</p>
              <p>Ctrl + Alt + Space 音声 / Ctrl + Alt + H HUD</p>
            </div>
          </aside>
        )}
      </div>

      {toast && (
        <div className="pointer-events-auto fixed bottom-5 left-1/2 z-50 flex max-w-[80vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--accent-dim)] bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--text-secondary)] shadow-lg">
          <span className="whitespace-pre-wrap">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
              className="shrink-0 rounded border border-[var(--accent-dim)] px-2 py-0.5 text-[10px] text-[var(--accent)]"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenHit={openSearchHit}
      />
      <MemoryDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      <ApprovalDialog
        request={approval}
        voiceEnabled={settings?.stt.handsFree ?? false}
        onDecide={(id, approved) => {
          setApproval(null);
          void resolveToolApproval(id, approved);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          void refreshAux();
        }}
      />
    </div>
  );
}
