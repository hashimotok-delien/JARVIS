import { useSyncExternalStore } from "react";
import { chatStore, type ChatSnapshot } from "../chat/chatStore";
import { settingsStore } from "../settings/settingsStore";
import { MicRecorder } from "./recorder";
import { TtsPlayer } from "./tts";
import { reportVoiceState, transcribe } from "../../lib/ipc/voice";
import { containsWakeWord, removeWakeWord } from "./wakeWord";
import { setHudPriority } from "../../lib/ipc/app";
import {
  VOICE_TOGGLE,
  onEvent,
  publishVoiceSpectrum,
  publishVoiceTranscript,
} from "../../lib/ipc/events";
import { logError } from "../../lib/logging";
import type { HudState } from "../../shared/types";

const TERMINATORS = new Set(["。", "！", "？", "!", "?", "\n"]);
const CLOSERS = new Set(["」", "』", "）", ")", '"', "”"]);

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
}

function extractSentences(text: string): {
  sentences: string[];
  consumed: number;
} {
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (!TERMINATORS.has(text[i])) continue;
    let end = i + 1;
    while (end < text.length && CLOSERS.has(text[end])) end += 1;
    const sentence = cleanForSpeech(text.slice(start, end));
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }

  return { sentences, consumed: start };
}

type Listener = () => void;

class VoiceEngine {
  private recorder = new MicRecorder();
  private tts = new TtsPlayer();
  private status: HudState = "idle";
  private listeners = new Set<Listener>();
  private initialized = false;
  private loopTimer: number | null = null;
  private resumeTimer: number | null = null;
  private listenStartedAt = 0;
  private speechDetected = false;
  private silenceStartedAt: number | null = null;
  private inflight = false;
  private lastAssistantId: string | null = null;
  private speechEligibleAssistantId: string | null = null;
  private lastObservedThreadId: string | null = null;
  private spokenChars = 0;
  private handsFreeActiveUntil = 0;
  private enrollmentPaused = false;
  private hudForeground = false;
  private hudBackTimer: number | null = null;
  private bargeTimer: number | null = null;
  private bargeHits = 0;
  private wakeWatchTimer: number | null = null;
  private wakeWatchRunning = false;

  lastError: string | null = null;
  lastTranscript = "";

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): HudState => this.status;

  pauseForEnrollment(): boolean {
    if (this.inflight || this.status === "thinking" || this.status === "speaking") {
      return false;
    }

    this.enrollmentPaused = true;
    this.clearResume();
    this.stopWakeWatch();
    this.stopBargeMonitor();
    this.stopLoop();
    this.recorder.cancel();
    if (this.status === "listening") {
      this.setStatus("idle");
    }
    return true;
  }

  resumeAfterEnrollment() {
    this.enrollmentPaused = false;
    this.scheduleHandsFree();
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    await settingsStore.init();
    settingsStore.subscribe(() => {
      const settings = settingsStore.get();
      if (!settings?.stt.handsFree) {
        this.handsFreeActiveUntil = 0;
        this.clearResume();
        return;
      }
      if (this.status === "idle") {
        void this.startListening();
      }
    });
    chatStore.subscribe(() => this.onChatChange());
    await onEvent<string>(VOICE_TOGGLE, () => {
      void this.toggle();
    });

    this.tts.onStart = () => {
      this.setStatus("speaking");
      this.startBargeMonitor();
    };
    this.tts.onIdle = () => {
      this.stopBargeMonitor();
      if (this.status === "speaking") {
        this.setStatus("idle");
      }
      this.scheduleHandsFree();
    };
    this.tts.onSpectrum = (values) => {
      void publishVoiceSpectrum(values);
    };

    const settings = settingsStore.get();
    if (settings?.tts.enabled) {
      this.tts.enqueue(
        `おかえりなさいませ、${settings.preferredName}様`,
      );
    }

    if (settings?.stt.handsFree) {
      window.setTimeout(() => {
        if (this.status === "idle" && !this.tts.busy) {
          void this.startListening();
        }
      }, 1200);
    }
  }

  async toggle() {
    this.lastError = null;

    if (this.status === "listening") {
      await this.finishListening(true);
      return;
    }
    if (this.status === "thinking") {
      return;
    }
    if (this.status === "speaking") {
      this.stopBargeMonitor();
      this.tts.stop();
      this.setStatus("idle");
      this.scheduleHandsFree();
      return;
    }

    await this.startListening();
  }

  private setStatus(next: HudState, detail?: string | null) {
    if (next === "thinking" || next === "speaking") {
      this.clearHudBack();
    } else if (next === "idle") {
      this.scheduleHudBackground();
    }
    const changed = this.status !== next;
    this.status = next;
    if (changed) {
      this.listeners.forEach((listener) => listener());
    }
    void reportVoiceState(next, detail ?? null);
  }

  private activateHud() {
    this.hudForeground = true;
    this.clearHudBack();
    void setHudPriority(true);
  }

  private scheduleHudBackground() {
    if (!this.hudForeground) return;
    this.clearHudBack();
    this.hudBackTimer = window.setTimeout(() => {
      this.hudBackTimer = null;
      if (this.status === "thinking" || this.status === "speaking") {
        this.scheduleHudBackground();
        return;
      }
      this.hudForeground = false;
      void setHudPriority(false);
    }, 10_000);
  }

  private clearHudBack() {
    if (this.hudBackTimer !== null) {
      window.clearTimeout(this.hudBackTimer);
      this.hudBackTimer = null;
    }
  }

  private async startListening() {
    if (this.status !== "idle" || this.enrollmentPaused) return;
    this.stopWakeWatch();
    this.stopBargeMonitor();
    const settings = settingsStore.get();
    if (!settings) return;

    if (!settings.stt.enabled) {
      this.setStatus("idle", "音声入力は無効です");
      return;
    }

    try {
      await this.recorder.start(settings.stt.inputDeviceId);
    } catch (error) {
      this.lastError = String(error);
      void logError("voice_recorder_start", error);
      this.setStatus("idle", this.lastError);
      this.listeners.forEach((listener) => listener());
      return;
    }

    this.clearResume();
    this.speechDetected = false;
    this.silenceStartedAt = null;
    this.listenStartedAt = performance.now();
    this.setStatus("listening");
    this.loopTimer = window.setInterval(() => this.tick(), 60);
  }

  private tick() {
    if (this.status !== "listening") return;
    const settings = settingsStore.get();
    if (!settings) return;

    const level = this.recorder.level();
    void publishVoiceSpectrum(this.recorder.spectrum());
    if (level >= settings.stt.threshold) {
      if (performance.now() < this.handsFreeActiveUntil) {
        if (!this.hudForeground) this.activateHud();
        this.handsFreeActiveUntil =
          performance.now() + settings.stt.followUpMs;
        this.clearHudBack();
      }
      this.speechDetected = true;
      this.silenceStartedAt = null;
    } else if (this.speechDetected) {
      if (this.silenceStartedAt === null) {
        this.silenceStartedAt = performance.now();
      } else if (
        performance.now() - this.silenceStartedAt >=
        settings.stt.silenceMs
      ) {
        void this.finishListening(false);
        return;
      }
    }

    if (performance.now() - this.listenStartedAt >= 20_000) {
      void this.finishListening(false);
    }
  }

  private async finishListening(userStop: boolean) {
    if (this.status !== "listening" || this.inflight) return;
    this.stopLoop();
    this.inflight = true;

    const recorded = await this.recorder.stop();
    void publishVoiceSpectrum(this.recorder.spectrum());
    const tooShort =
      !recorded ||
      recorded.durationMs < 400 ||
      (!this.speechDetected && !userStop);

    if (tooShort) {
      this.inflight = false;
      this.setStatus("idle");
      this.scheduleHandsFree();
      return;
    }

    this.setStatus("thinking");
    try {
      const text = (await transcribe(recorded.base64)).trim();
      if (!text) {
        this.setStatus("idle");
        this.scheduleHandsFree();
        return;
      }
      const settings = settingsStore.get();
      let message = text;
      if (settings?.stt.handsFree) {
        const wakeRemainder = removeWakeWord(
          text,
          settings.stt.wakeSamples,
        );
        const isActive = performance.now() < this.handsFreeActiveUntil;
        if (wakeRemainder === null && !isActive) {
          this.setStatus("idle");
          this.scheduleHandsFree();
          return;
        }
        if (wakeRemainder !== null) {
          this.activateHud();
          this.handsFreeActiveUntil =
            performance.now() + settings.stt.followUpMs;
          message = wakeRemainder;
          if (!message) {
            this.lastTranscript = "";
            void publishVoiceTranscript("", true);
            this.tts.enqueue(
              `${settings.preferredName}様、ご要件はなんでしょうか？`,
            );
            this.setStatus("idle");
            return;
          }
        } else {
          this.handsFreeActiveUntil =
            performance.now() + settings.stt.followUpMs;
        }
        if (!message) {
          this.setStatus("idle");
          this.scheduleHandsFree();
          return;
        }
      }

      this.lastTranscript = message;
      void publishVoiceTranscript(message, true);
      await chatStore.send(message, null, "voice");
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : String(error);
      void logError("voice_transcribe_or_send", error);
      this.setStatus("idle", this.lastError);
      this.listeners.forEach((listener) => listener());
      this.scheduleHandsFree();
    } finally {
      this.inflight = false;
    }
  }

  private onChatChange() {
    const snapshot = chatStore.getSnapshot();

    // Reflect typed chat generation in the HUD/tray indicator too.
    if (snapshot.streaming && this.status === "idle" && !this.enrollmentPaused) {
      this.setStatus("thinking");
    }

    this.pumpTts(snapshot);

    if (!snapshot.streaming && this.status === "thinking" && !this.tts.busy) {
      this.setStatus("idle");
      this.scheduleHandsFree();
    }
  }

  private pumpTts(snapshot: ChatSnapshot) {
    if (snapshot.activeThreadId !== this.lastObservedThreadId) {
      this.lastObservedThreadId = snapshot.activeThreadId;
      this.lastAssistantId = null;
      this.speechEligibleAssistantId = null;
      this.spokenChars = 0;
    }

    const settings = settingsStore.get();
    if (!settings?.tts.enabled) return;

    const assistant = [...snapshot.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!assistant) return;

    if (assistant.pending) {
      this.speechEligibleAssistantId = assistant.id;
    }
    if (this.speechEligibleAssistantId !== assistant.id) return;

    if (assistant.id !== this.lastAssistantId) {
      this.lastAssistantId = assistant.id;
      this.spokenChars = 0;
    }

    if (assistant.content.length <= this.spokenChars) return;

    const fresh = assistant.content.slice(this.spokenChars);
    const { sentences, consumed } = extractSentences(fresh);
    sentences.forEach((sentence) => this.tts.enqueue(sentence));
    this.spokenChars += consumed;

    const finished = !snapshot.streaming && !assistant.pending;
    if (finished && consumed < fresh.length) {
      const rest = cleanForSpeech(fresh.slice(consumed));
      if (rest) this.tts.enqueue(rest);
      this.spokenChars += fresh.length - consumed;
    }
  }

  /** Listen while speaking and stop playback when the user starts talking. */
  private startBargeMonitor() {
    const settings = settingsStore.get();
    if (!settings?.tts.bargeIn || !settings.stt.enabled) return;
    if (this.recorder.active) return;
    this.stopBargeMonitor();

    void this.recorder
      .start()
      .then(() => {
        const threshold = Math.max(
          0.02,
          (settingsStore.get()?.stt.threshold ?? 0.02) * 2,
        );
        this.bargeHits = 0;
        this.bargeTimer = window.setInterval(() => {
          if (this.status !== "speaking") return;
          if (this.recorder.level() >= threshold) {
            this.bargeHits += 1;
          } else {
            this.bargeHits = Math.max(0, this.bargeHits - 1);
          }
          if (this.bargeHits >= 3) {
            this.stopBargeMonitor();
            this.tts.stop();
            this.setStatus("idle");
            void this.startListening();
          }
        }, 90);
      })
      .catch(() => undefined);
  }

  private stopBargeMonitor() {
    if (this.bargeTimer !== null) {
      window.clearInterval(this.bargeTimer);
      this.bargeTimer = null;
    }
    this.bargeHits = 0;
    if (this.status !== "listening") {
      this.recorder.cancel();
    }
  }

  /** Dedicated wake-word polling loop (short windows) while idle. */
  private startWakeWatch() {
    const settings = settingsStore.get();
    if (
      !settings?.stt.wakeWatch ||
      !settings.stt.handsFree ||
      this.status !== "idle" ||
      this.enrollmentPaused ||
      this.wakeWatchRunning
    ) {
      return;
    }

    this.wakeWatchRunning = true;
    const loop = async () => {
      const current = settingsStore.get();
      if (
        !current?.stt.wakeWatch ||
        !current.stt.handsFree ||
        this.status !== "idle" ||
        this.enrollmentPaused
      ) {
        this.stopWakeWatch();
        return;
      }
      if (this.recorder.active) {
        this.wakeWatchTimer = window.setTimeout(loop, 300);
        return;
      }
      try {
        await this.recorder.start(current.stt.inputDeviceId);
        await new Promise((resolve) => window.setTimeout(resolve, 1800));
        const recorded = await this.recorder.stop();
        if (recorded && recorded.durationMs >= 700) {
          const text = await transcribe(recorded.base64);
          if (
            text &&
            containsWakeWord(text, current.stt.wakeSamples)
          ) {
            this.activateHud();
            this.handsFreeActiveUntil =
              performance.now() + current.stt.followUpMs;
            this.stopWakeWatch();
            await this.startListening();
            return;
          }
        }
      } catch (error) {
        void logError("wake_watch", error);
      }
      if (this.wakeWatchRunning) {
        this.wakeWatchTimer = window.setTimeout(loop, 250);
      }
    };
    void loop();
  }

  private stopWakeWatch() {
    this.wakeWatchRunning = false;
    if (this.wakeWatchTimer !== null) {
      window.clearTimeout(this.wakeWatchTimer);
      this.wakeWatchTimer = null;
    }
  }

  private scheduleHandsFree() {
    const settings = settingsStore.get();
    if (!settings?.stt.handsFree) return;
    if (this.enrollmentPaused) return;
    if (this.status !== "idle") return;

    if (settings.stt.wakeWatch) {
      this.startWakeWatch();
      return;
    }

    this.clearResume();
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null;
      if (
        this.status === "idle" &&
        settingsStore.get()?.stt.handsFree &&
        !this.tts.busy
      ) {
        void this.startListening();
      }
    }, 500);
  }

  private clearResume() {
    if (this.resumeTimer !== null) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private stopLoop() {
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  stopSpeaking() {
    this.stopBargeMonitor();
    this.tts.stop();
    if (this.status === "speaking") {
      this.setStatus("idle");
    }
  }
}

export const voiceEngine = new VoiceEngine();

export function useVoiceStatus(): HudState {
  return useSyncExternalStore(
    voiceEngine.subscribe,
    voiceEngine.getStatus,
  );
}
