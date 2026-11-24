import { useMemo, useState } from "react";
import { MessageSquare, Pin, Plus, Search } from "lucide-react";
import type { Thread } from "../../shared/types";

interface ThreadListProps {
  threads: Thread[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

export default function ThreadList({
  threads,
  activeId,
  onSelect,
  onCreate,
}: ThreadListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return threads;
    return threads.filter((thread) =>
      thread.title.toLowerCase().includes(keyword),
    );
  }, [query, threads]);

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="スレッドを検索"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-dim)] select-text"
          />
        </div>
        <button
          type="button"
          onClick={onCreate}
          title="新しいスレッド"
          className="rounded-md border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--accent-dim)] hover:text-[var(--accent)]"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-[var(--text-muted)]">
            該当するスレッドがありません
          </p>
        )}

        {filtered.map((thread) => {
          const active = thread.id === activeId;
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelect(thread.id)}
              className={`group mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                active
                  ? "border-[var(--accent-dim)] bg-[var(--bg-hover)]"
                  : "border-transparent hover:bg-[var(--bg-elevated)]"
              }`}
            >
              <MessageSquare
                size={13}
                className={`mt-0.5 shrink-0 ${
                  active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-xs ${
                    active
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  {thread.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  {thread.pinned && (
                    <Pin size={9} className="text-[var(--accent)]" />
                  )}
                  {formatRelative(thread.updatedAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
