import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { SearchHit } from "../../shared/types";
import { searchMessages } from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onOpenHit: (hit: SearchHit) => void;
}

export default function SearchOverlay({
  open,
  onClose,
  onOpenHit,
}: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const keyword = query.trim();
    if (!keyword) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchMessages(keyword, 30)
        .then((results) => {
          setHits(results);
          setActive(0);
        })
        .catch((error) => void logError("search_messages", error))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const hint = useMemo(() => {
    if (loading) return "検索中…";
    if (!query.trim()) return "キーワードを入力（全スレッドの本文を検索）";
    return `${hits.length} 件`;
  }, [loading, query, hits.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-6 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
          ) : (
            <Search size={14} className="text-[var(--text-muted)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, hits.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter" && hits[active]) {
                onOpenHit(hits[active]);
                onClose();
              }
            }}
            placeholder="会話を検索…"
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] select-text"
          />
          <span className="text-[10px] text-[var(--text-muted)]">{hint}</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-[var(--text-muted)]">
              {query.trim() ? "該当する発言がありません" : "Ctrl + K でいつでも開けます"}
            </p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={hit.messageId}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onOpenHit(hit);
                  onClose();
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left transition ${
                  index === active
                    ? "bg-[var(--bg-hover)]"
                    : "hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <span className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span
                    className={
                      hit.role === "user"
                        ? "text-[var(--text-secondary)]"
                        : "text-[var(--accent)]"
                    }
                  >
                    {hit.role === "user" ? "あなた" : "J.A.R.V.I.S."}
                  </span>
                  <span className="truncate">{hit.threadTitle}</span>
                  <span className="ml-auto shrink-0">
                    {new Date(hit.createdAt).toLocaleString()}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">
                  {hit.snippet}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
