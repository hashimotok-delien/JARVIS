import { useEffect, useState } from "react";
import { BookOpen, Brain, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Memory, Template } from "../../shared/types";
import {
  addMemory,
  addTemplate,
  dailyDigest,
  deleteMemory,
  deleteTemplate,
  listMemories,
  listTemplates,
  updateMemory,
} from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";

interface MemoryDialogProps {
  open: boolean;
  onClose: () => void;
}

const INPUT =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-dim)] select-text";

export default function MemoryDialog({ open, onClose }: MemoryDialogProps) {
  const [tab, setTab] = useState<"memory" | "template">("memory");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [memoryList, templateList] = await Promise.all([
        listMemories(),
        listTemplates(),
      ]);
      setMemories(memoryList);
      setTemplates(templateList);
    } catch (error) {
      void logError("load_memory_dialog", error);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    setDigest(null);
  }, [open]);

  if (!open) return null;

  const saveMemory = async () => {
    const text = content.trim();
    if (!text) return;
    setBusy(true);
    try {
      if (editingId) {
        await updateMemory(editingId, text);
      } else {
        await addMemory(text, "manual");
      }
      setContent("");
      setEditingId(null);
      await load();
    } catch (error) {
      void logError("save_memory", error);
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !templateBody.trim()) return;
    setBusy(true);
    try {
      await addTemplate(templateName.trim(), templateBody.trim());
      setTemplateName("");
      setTemplateBody("");
      await load();
    } catch (error) {
      void logError("save_template", error);
    } finally {
      setBusy(false);
    }
  };

  const runDigest = async () => {
    setBusy(true);
    try {
      setDigest(await dailyDigest());
    } catch (error) {
      void logError("daily_digest", error);
      setDigest(`失敗しました: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">記憶とテンプレート</h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              長期記憶は応答時に自動で参照されます。テンプレートは /t 名前 で呼び出せます。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] px-3 py-2">
          <button
            type="button"
            onClick={() => setTab("memory")}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
              tab === "memory"
                ? "bg-[var(--bg-hover)] text-[var(--accent)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <Brain size={12} /> 記憶 ({memories.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("template")}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
              tab === "template"
                ? "bg-[var(--bg-hover)] text-[var(--accent)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <BookOpen size={12} /> テンプレート ({templates.length})
          </button>
          <button
            type="button"
            onClick={() => void runDigest()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-40"
          >
            <Sparkles size={11} /> 今日の振り返り
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {digest && (
            <pre className="whitespace-pre-wrap rounded-lg border border-[var(--accent-dim)] bg-[var(--bg-elevated)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)] select-text">
              {digest}
            </pre>
          )}

          {tab === "memory" ? (
            <>
              <div className="flex gap-2">
                <input
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveMemory();
                  }}
                  placeholder="覚えておいてほしいこと（例: 私はコーヒーが好き）"
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() => void saveMemory()}
                  disabled={busy || !content.trim()}
                  className="shrink-0 rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] disabled:opacity-40"
                >
                  {editingId ? "更新" : <Plus size={12} />}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setContent("");
                    }}
                    className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
                  >
                    取消
                  </button>
                )}
              </div>

              {memories.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-[var(--text-muted)]">
                  まだ記憶はありません。「これ覚えて」と話すか、上の欄から追加できます。
                </p>
              ) : (
                <ul className="space-y-1">
                  {memories.map((memory) => (
                    <li
                      key={memory.id}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1 select-text text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {memory.content}
                      </span>
                      <span className="shrink-0 rounded border border-[var(--border-subtle)] px-1 text-[9px] text-[var(--text-muted)]">
                        {memory.kind}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(memory.id);
                          setContent(memory.content);
                        }}
                        className="shrink-0 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)]"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteMemory(memory.id).then(load);
                        }}
                        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--error)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="名前（例: 校正）"
                  className={INPUT}
                />
                <textarea
                  value={templateBody}
                  onChange={(event) => setTemplateBody(event.target.value)}
                  rows={3}
                  placeholder="挿入するプロンプト本文"
                  className={`${INPUT} resize-none`}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveTemplate()}
                    disabled={
                      busy || !templateName.trim() || !templateBody.trim()
                    }
                    className="rounded-md border border-[var(--accent-dim)] px-2 py-1 text-[10px] text-[var(--accent)] disabled:opacity-40"
                  >
                    追加
                  </button>
                </div>
              </div>

              {templates.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-[var(--text-muted)]">
                  テンプレートはまだありません。
                </p>
              ) : (
                <ul className="space-y-1">
                  {templates.map((template) => (
                    <li
                      key={template.id}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-[var(--accent)]">
                          /t {template.name}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-muted)]">
                          {template.body}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteTemplate(template.id).then(load);
                        }}
                        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--error)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
