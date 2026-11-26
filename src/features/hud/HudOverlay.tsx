import { useEffect, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import { Mic, Volume2, VolumeX, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HudRing from "./HudRing";
import Dashboard from "./DashboardPanels";
import { HUD_STATE_META } from "./states";
import { fetchWeather } from "./weather";
import { isTauri, requestVoiceToggle } from "../../lib/ipc/app";
import { listMessages, listThreads } from "../../lib/ipc/chat";
import { systemStats, usageStats } from "../../lib/ipc/assistant";
import { logError } from "../../lib/logging";
import { toggleMute } from "../../lib/ipc/settings";
import { applyHudTheme } from "../../shared/theme/palette";
import {
  CHAT_DELTA,
  CHAT_DONE,
  CHAT_ERROR,
  CHAT_PROVIDER,
  CHAT_TITLE,
  VOICE_SPECTRUM,
  VOICE_STATE,
  VOICE_TRANSCRIPT,
  onEvent,
} from "../../lib/ipc/events";
import { settingsStore } from "../settings/settingsStore";
import { useSettings } from "../settings/settingsStore";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatProviderEvent,
  ChatTitleEvent,
  HudState,
  SystemStats,
  UsageStats,
  VoiceSpectrumEvent,
  VoiceStateEvent,
  VoiceTranscriptEvent,
  WeatherReport,
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

export default function HudOverlay() {
  const settings = useSettings();
  const [state, setState] = useState<HudState>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [userInput, setUserInput] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [spectrum, setSpectrum] = useState<number[]>([]);
  const [heard, setHeard] = useState("");
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);

  const expanded = (settings?.hud.width ?? 380) >= 600;
  const staticMode = settings?.hud.staticMode ?? false;

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
        const lastRequest = [...messages]
          .reverse()
          .find((message) => message.role === "user");
        if (lastReply?.content) {
          setSubtitle(lastReply.content);
        }
        if (lastRequest?.content) setUserInput(lastRequest.content);
      } catch (error) {
        void logError("hud_load_latest_message", error);
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
      setProviderModel(`${payload.provider} · ${payload.model}`);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatProviderEvent>(CHAT_PROVIDER, (payload) => {
      setProviderModel(`${payload.provider} · ${payload.model}`);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatErrorEvent>(CHAT_ERROR, (payload) => {
      setErrorText(payload.error);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<ChatTitleEvent>(CHAT_TITLE, () => {
      setErrorText(null);
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<VoiceTranscriptEvent>(VOICE_TRANSCRIPT, (payload) => {
      if (payload.isFinal) {
        setUserInput(payload.text);
        setHeard("");
      } else {
        // Wake-word probing result: show it small so misses are diagnosable.
        setHeard(payload.text);
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    void onEvent<VoiceSpectrumEvent>(VOICE_SPECTRUM, (payload) => {
      setSpectrum(payload.values);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // Apply the accent-derived palette (separate window, so re-apply here).
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.ui.theme;
    applyHudTheme(settings.ui);
  }, [settings]);

  // Usage: refresh once a minute while the dashboard is visible.
  useEffect(() => {
    if (!expanded || !settings?.hud.showUsage) return;
    let active = true;
    const load = () => {
      void usageStats().then((next) => {
        if (active) setUsage(next);
      });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [expanded, settings?.hud.showUsage]);

  // System telemetry: cheap, so poll every 2 seconds.
  useEffect(() => {
    if (!expanded || !settings?.hud.showSystem) return;
    let active = true;
    const load = () => {
      void systemStats().then((next) => {
        if (active && next) setStats(next);
      });
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [expanded, settings?.hud.showSystem]);

  // Weather: Open-Meteo, cached for 10 minutes.
  useEffect(() => {
    if (!expanded || !settings?.hud.showWeather) return;
    let active = true;
    const { weatherCity, weatherLat, weatherLon } = settings.hud;
    const load = () => {
      void fetchWeather(weatherCity, weatherLat, weatherLon).then((next) => {
        if (active && next) setWeather(next);
      });
    };
    load();
    const timer = window.setInterval(load, 10 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    expanded,
    settings?.hud.showWeather,
    settings?.hud.weatherCity,
    settings?.hud.weatherLat,
    settings?.hud.weatherLon,
  ]);

  const meta = HUD_STATE_META[state];
  const muted = settings ? !settings.tts.enabled : false;
  const listening = state === "listening";

  const close = () => {
    if (isTauri) {
      void getCurrentWindow().hide();
    }
  };

  const visibleText = errorText ?? subtitle;

  return (
    <MotionConfig reducedMotion={staticMode ? "always" : "user"}>
    <div className="flex h-full w-full items-center justify-center p-2">
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border ${
          staticMode ? "" : "backdrop-blur-xl"
        }`}
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
          background:
            settings?.ui.theme === "light"
              ? "linear-gradient(150deg, rgba(255,255,255,0.95) 0%, " +
                "rgba(240,245,250,0.90) 100%)"
              : "linear-gradient(150deg, rgba(10,17,26,0.92) 0%, " +
                "rgba(6,10,16,0.86) 100%)",
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent), " +
            "0 18px 40px rgba(0,0,0,0.55)",
        }}
      >
        <header
          data-tauri-drag-region={settings?.hud.pinned ? undefined : ""}
          className="flex items-center justify-between px-3 py-1.5"
        >
          <span
            data-tauri-drag-region={settings?.hud.pinned ? undefined : ""}
            className="flex items-center gap-1.5 text-[10px] tracking-[0.34em] text-[var(--text-muted)]"
          >
            <img
              src="/jarvis.png"
              alt=""
              aria-hidden="true"
              className="h-4 w-4 rounded-sm object-cover"
            />
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

        <div className="flex min-h-0 flex-1 items-stretch gap-3 px-3 pb-2">
          <div className="flex shrink-0 items-center">
            <HudRing
              state={state}
              size={expanded ? 132 : 88}
              spectrum={spectrum}
              static={staticMode}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

            {providerModel && (
              <span className="mt-0.5 text-[9px] text-[var(--text-muted)]">
                {providerModel}
              </span>
            )}

            {heard && state === "idle" && (
              <span className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">
                聞き取り: {heard}
              </span>
            )}

            {expanded && userInput && (
              <div className="mt-1 min-h-0 overflow-y-auto rounded border border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[9px] tracking-wider text-[var(--accent)]">
                  YOU
                </span>
                <p className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[var(--text-secondary)]">
                  {userInput}
                </p>
              </div>
            )}

            <p className="mt-0.5 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text-secondary)]">
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

          {expanded && settings && (
            <Dashboard
              hud={settings.hud}
              stats={stats}
              weather={weather}
              usage={usage}
            />
          )}
        </div>
      </div>
    </div>
    </MotionConfig>
  );
}
