import { useState } from "react";
import { motion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import HudRing from "./HudRing";
import { HUD_STATE_META, HUD_STATE_ORDER } from "./states";
import { isTauri } from "../../lib/ipc/app";
import type { HudState } from "../../shared/types";

function WaveBars({ active }: { active: boolean }) {
  return (
    <div className="flex h-4 items-end gap-[3px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          animate={
            active
              ? { height: [4, 14, 6, 12, 4] }
              : { height: [3, 5, 3] }
          }
          transition={
            active
              ? {
                  repeat: Infinity,
                  duration: 0.9,
                  delay: i * 0.08,
                  ease: "easeInOut",
                }
              : { repeat: Infinity, duration: 2.4, delay: i * 0.1 }
          }
        />
      ))}
    </div>
  );
}

export default function HudOverlay() {
  const [state, setState] = useState<HudState>("idle");
  const meta = HUD_STATE_META[state];

  const close = () => {
    if (isTauri) {
      void getCurrentWindow().hide();
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-2">
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-xl"
        style={{
          borderColor: "rgba(0, 229, 255, 0.22)",
          background:
            "linear-gradient(150deg, rgba(10,17,26,0.92) 0%, " +
            "rgba(6,10,16,0.86) 100%)",
          boxShadow:
            "0 0 0 1px rgba(0,229,255,0.06), " +
            "0 18px 40px rgba(0,0,0,0.55)",
        }}
      >
        <header
          data-tauri-drag-region
          className="flex items-center justify-between px-3 py-1.5"
        >
          <span
            data-tauri-drag-region
            className="text-[10px] tracking-[0.34em] text-[var(--text-muted)]"
          >
            J.A.R.V.I.S.
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="HUDを閉じる"
            className="rounded p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={12} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center gap-2 px-3 pb-3">
          <HudRing state={state} size={92} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-semibold tracking-wide"
                style={{ color: meta.color }}
              >
                {meta.label}
              </span>
              <span style={{ color: meta.color }}>
                <WaveBars
                  active={state === "listening" || state === "speaking"}
                />
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {meta.hint}
            </p>

            <div className="mt-2 flex items-center gap-1.5">
              {HUD_STATE_ORDER.map((s) => {
                const active = s === state;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setState(s)}
                    title={`${HUD_STATE_META[s].label}（P0プレビュー）`}
                    className="h-1.5 w-6 rounded-full transition"
                    style={{
                      background: active
                        ? HUD_STATE_META[s].color
                        : "var(--border-strong)",
                      boxShadow: active
                        ? `0 0 8px ${HUD_STATE_META[s].color}`
                        : undefined,
                    }}
                  />
                );
              })}
              <span className="ml-1 text-[9px] text-[var(--text-muted)]">
                P0 preview
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
