import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Volume2, VolumeX, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HudRing from "./HudRing";
import { HUD_STATE_META } from "./states";
import { isTauri, requestVoiceToggle } from "../../lib/ipc/app";
import { listMessages, listThreads } from "../../lib/ipc/chat";
import { toggleMute } from "../../lib/ipc/settings";
import {
  CHAT_DELTA,
  CHAT_DONE,
  CHAT_ERROR,
  CHAT_TITLE,
  VOICE_STATE,
  onEvent,
} from "../../lib/ipc/events";
import { settingsStore } from "../settings/settingsStore";
import { useSettings } from "../settings/settingsStore";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatTitleEvent,
  HudState,
  VoiceStateEvent,
} from "../../shared/types";

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

const MAX_SUBTITLE = 260;

export default function HudOverlay() {
  const settings = useSettings();
  const [state, setState] = useState<HudState>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    void settingsStore.init();

    const unlisteners: Array<() => void> = [];

    // Show the most recent reply as soon as the HUD opens.
    void (async () => {
      try {
        const threads = await listThreads();
        const latest = threads[0];
        if (!latest) return;
        const messages = await listMessages(latest.id);
        const lastReply = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (lastReply?.content) {
          setSubtitle(lastReply.content);
        }
      } catch {
        // The HUD still works without a stored thread.
      }
    })();

    void onEvent<VoiceStateEvent>(VOICE_STATE, (payload) => {
      setState(payload.state);
      setDetail(payload.detail ?? null);
      if (payload.state === "listening") {
        setSubtitle("");
        setErrorText(null);
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatDeltaEvent>(CHAT_DELTA, (payload) => {
      setSubtitle((current) => current + payload.delta);
      setErrorText(null);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatDoneEvent>(CHAT_DONE, (payload) => {
      setSubtitle(payload.content);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatErrorEvent>(CHAT_ERROR, (payload) => {
      setErrorText(payload.error);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatTitleEvent>(CHAT_TITLE, () => {
      setErrorText(null);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const meta = HUD_STATE_META[state];
  const muted = settings ? !settings.tts.enabled : false;
  const listening = state === "listening";

  const close = () => {
    if (isTauri) {
      void getCurrentWindow().hide();
    }
  };

  const visibleText =
    errorText ?? (subtitle.length > MAX_SUBTITLE
      ? `…${subtitle.slice(-MAX_SUBTITLE)}`
      : subtitle);

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

        <div className="flex min-h-0 flex-1 items-center gap-2 px-3 pb-2">
          <HudRing state={state} size={88} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-semibold tracking-wide"
                style={{ color: meta.color }}
              >
                {meta.label}
              </span>
              <span style={{ color: meta.color }}>
                <WaveBars
                  active={listening || state === "speaking"}
                />
              </span>
            </div>

            <p className="mt-0.5 line-clamp-3 min-h-[38px] text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {visibleText ||
                (detail ?? meta.hint)}
            </p>

            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void requestVoiceToggle()}
                title={listening ? "聞き取りを停止" : "音声入力"}
                className={`rounded-md border p-1 transition ${
                  listening
                    ? "border-[var(--error)]/60 bg-[var(--error)]/10 text-[var(--error)]"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                <Mic size={12} />
              </button>
              <button
                type="button"
                onClick={() => void toggleMute()}
                title={muted ? "ミュート解除" : "ミュート"}
                className={`rounded-md border p-1 transition ${
                  muted
                    ? "border-[var(--warn)]/60 text-[var(--warn)]"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>

              {settings?.stt.handsFree && (
                <span className="rounded-full border border-[var(--accent-dim)] px-1.5 py-0.5 text-[9px] text-[var(--accent)]">
                  HANDS-FREE
                </span>
              )}
              {muted && (
                <span className="rounded-full border border-[var(--warn)]/50 px-1.5 py-0.5 text-[9px] text-[var(--warn)]">
                  MUTED
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
