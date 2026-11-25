import { useEffect, useState } from "react";
import {
  FolderOpen,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import type { LocalService, ServiceStatus } from "../../shared/types";
import {
  listLocalServices,
  startLocalService,
  stopAllLocalServices,
  stopLocalService,
} from "../../lib/ipc/services";
import { pickFolder } from "../../lib/ipc/dialog";
import { logError } from "../../lib/logging";

interface LocalServicesSettingsProps {
  services: LocalService[];
  onChange: (services: LocalService[]) => void;
}

const INPUT =
  "w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] " +
  "px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] outline-none " +
  "focus:border-[var(--accent-dim)] select-text";

const PRESETS: LocalService[] = [
  {
    name: "ollama",
    command: "ollama",
    args: ["serve"],
    cwd: "",
    healthUrl: "http://127.0.0.1:11434/api/tags",
    autoStart: true,
    stopOnExit: true,
    enabled: true,
  },
  {
    name: "opencode",
    command: "opencode",
    args: ["web", "--hostname", "0.0.0.0", "--port", "3000"],
    cwd: "",
    healthUrl: "http://127.0.0.1:3000/",
    autoStart: true,
    stopOnExit: true,
    enabled: true,
  },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative h-4 w-7 shrink-0 rounded-full border transition ${
        checked
          ? "border-[var(--accent-dim)] bg-[var(--accent-dim)]"
          : "border-[var(--border-strong)] bg-[var(--bg-hover)]"
      }`}
    >
      <span
        className={`block h-3 w-3 rounded-full transition ${
          checked
            ? "translate-x-[13px] bg-[var(--accent)]"
            : "translate-x-[2px] bg-[var(--text-muted)]"
        }`}
      />
    </button>
  );
}

export default function LocalServicesSettings({
  services,
  onChange,
}: LocalServicesSettingsProps) {
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = async () => {
    const list = await listLocalServices();
    setStatuses(
      Object.fromEntries(list.map((status) => [status.name, status])),
    );
  };

  useEffect(() => {
    void refresh();
  }, []);

  const patch = (index: number, changes: Partial<LocalService>) => {
    onChange(
      services.map((service, itemIndex) =>
        itemIndex === index ? { ...service, ...changes } : service,
      ),
    );
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const result = await action();
      if (typeof result === "string") setNote(result);
      await refresh();
    } catch (error) {
      void logError("local_service", error);
      setNote(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
        JARVIS 起動時にここで ON の「自動起動」サービスを開始し、JARVIS
        終了時に JARVIS が起動したものだけを停止します。既に外部で起動している
        サービスは停止しません。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          <RefreshCw size={10} /> 状態更新
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              let started = 0;
              for (const service of services.filter((item) => item.enabled)) {
                try {
                  await startLocalService(service);
                  started += 1;
                } catch (error) {
                  void logError("start_service", error);
                }
              }
              return `${started} 件を起動しました`;
            })
          }
          className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-40"
        >
          <Play size={10} /> すべて起動
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const count = await stopAllLocalServices();
              return `${count} 件を停止しました`;
            })
          }
          className="flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--error)] disabled:opacity-40"
        >
          <Square size={10} /> すべて停止
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => onChange([...services, { ...preset, args: [...preset.args] }])}
            className="flex items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
          >
            <Plus size={10} /> {preset.name} を追加
          </button>
        ))}
      </div>

      {services.length === 0 && (
        <p className="py-3 text-center text-[10px] text-[var(--text-muted)]">
          サービスはまだ登録されていません。上のプリセットから追加できます。
        </p>
      )}

      {services.map((service, index) => {
        const status = statuses[service.name];
        return (
          <div
            key={`${service.name}-${index}`}
            className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
          >
            <div className="flex items-center gap-2">
              <Toggle
                checked={service.enabled}
                onChange={(enabled) => patch(index, { enabled })}
              />
              <input
                value={service.name}
                onChange={(event) => patch(index, { name: event.target.value })}
                placeholder="名前"
                className="w-[110px] rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 text-[10px] outline-none select-text"
              />
              <span
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${
                  status?.running
                    ? "border-[var(--ok)]/50 text-[var(--ok)]"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)]"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    status?.running ? "bg-[var(--ok)]" : "bg-[var(--text-muted)]"
                  }`}
                />
                {status?.detail ?? "未確認"}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy || !service.enabled}
                  onClick={() => void run(() => startLocalService(service))}
                  title="起動"
                  className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--ok)] disabled:opacity-30"
                >
                  <Play size={11} />
                </button>
                <button
                  type="button"
                  disabled={busy || !status?.owned}
                  onClick={() =>
                    void run(async () => {
                      const stopped = await stopLocalService(service.name);
                      return stopped
                        ? `${service.name} を停止しました`
                        : "JARVIS が起動したサービスではありません";
                    })
                  }
                  title="停止（JARVISが起動した場合のみ）"
                  className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--error)] disabled:opacity-30"
                >
                  <Square size={11} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(services.filter((_, itemIndex) => itemIndex !== index))
                  }
                  title="削除"
                  className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </div>

            <div className="grid grid-cols-[96px_1fr] items-center gap-1.5">
              <span className="text-[9px] text-[var(--text-muted)]">コマンド</span>
              <input
                value={service.command}
                onChange={(event) => patch(index, { command: event.target.value })}
                placeholder="ollama"
                className={INPUT}
              />
              <span className="text-[9px] text-[var(--text-muted)]">引数</span>
              <input
                value={service.args.join(" ")}
                onChange={(event) =>
                  patch(index, {
                    args: event.target.value.split(/\s+/).filter(Boolean),
                  })
                }
                placeholder="serve"
                className={INPUT}
              />
              <span className="text-[9px] text-[var(--text-muted)]">作業フォルダ</span>
              <span className="flex gap-1">
                <input
                  value={service.cwd}
                  onChange={(event) => patch(index, { cwd: event.target.value })}
                  placeholder="空欄で JARVIS と同じ場所"
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() =>
                    void pickFolder({ title: "作業フォルダを選択" }).then(
                      (path) => {
                        if (path) patch(index, { cwd: path });
                      },
                    )
                  }
                  className="shrink-0 rounded border border-[var(--border-strong)] p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                >
                  <FolderOpen size={10} />
                </button>
              </span>
              <span className="text-[9px] text-[var(--text-muted)]">ヘルスURL</span>
              <input
                value={service.healthUrl}
                onChange={(event) => patch(index, { healthUrl: event.target.value })}
                placeholder="http://127.0.0.1:11434/api/tags"
                className={INPUT}
              />
            </div>

            <div className="flex items-center gap-4 text-[10px] text-[var(--text-secondary)]">
              <label className="flex items-center gap-1.5">
                <Toggle
                  checked={service.autoStart}
                  onChange={(autoStart) => patch(index, { autoStart })}
                />
                起動時に自動起動
              </label>
              <label className="flex items-center gap-1.5">
                <Toggle
                  checked={service.stopOnExit}
                  onChange={(stopOnExit) => patch(index, { stopOnExit })}
                />
                終了時に停止
              </label>
            </div>
          </div>
        );
      })}

      {note && (
        <p className="text-[10px] text-[var(--accent)]">{note}</p>
      )}
    </div>
  );
}
