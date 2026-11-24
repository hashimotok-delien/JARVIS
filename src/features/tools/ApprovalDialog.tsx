import { ShieldAlert, ShieldCheck, X } from "lucide-react";
import type { ToolApprovalEvent } from "../../shared/types";

interface ApprovalDialogProps {
  request: ToolApprovalEvent | null;
  onDecide: (id: string, approved: boolean) => void;
}

const LABELS: Record<string, string> = {
  write_file: "ファイルに書き込み",
  launch_app: "アプリを起動",
  open_url: "URLを開く",
};

export default function ApprovalDialog({
  request,
  onDecide,
}: ApprovalDialogProps) {
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--warn)]/60 bg-[var(--bg-base)] shadow-2xl">
        <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <ShieldAlert size={16} className="text-[var(--warn)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            ツール実行の許可
          </h3>
          <button
            type="button"
            onClick={() => onDecide(request.id, false)}
            className="ml-auto rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <p className="text-[12px] text-[var(--text-secondary)]">
            J.A.R.V.I.S. が次の操作を実行しようとしています。
          </p>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
            <p className="text-[10px] tracking-wide text-[var(--accent)]">
              {LABELS[request.tool] ?? request.tool}
            </p>
            <p className="mt-1 break-all text-[11px] text-[var(--text-primary)] select-text">
              {request.summary}
            </p>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={() => onDecide(request.id, false)}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            拒否
          </button>
          <button
            type="button"
            onClick={() => onDecide(request.id, true)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--accent-dim)] bg-[var(--accent-dim)]/30 px-3 py-1.5 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-dim)]/50"
          >
            <ShieldCheck size={12} /> 許可
          </button>
        </footer>
      </div>
    </div>
  );
}
