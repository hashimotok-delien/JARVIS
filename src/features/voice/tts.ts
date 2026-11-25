import { speak } from "../../lib/ipc/voice";
import { logError } from "../../lib/logging";

const SPECTRUM_BARS = 32;

function emptySpectrum(): number[] {
  return new Array(SPECTRUM_BARS).fill(0);
}

/**
 * Sequential TTS playback queue. Sentences are synthesized one at a time so
 * the assistant can start speaking before the reply has finished streaming.
 */
export class TtsPlayer {
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private audio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId = 0;
  private spectrumSource: MediaElementAudioSourceNode | null = null;
  private spectrumAnalyser: AnalyserNode | null = null;

  onStart: (() => void) | null = null;
  onIdle: (() => void) | null = null;
  /** Frequency levels (0..1) for the HUD ring while the assistant speaks. */
  onSpectrum: ((values: number[]) => void) | null = null;

  private ensureContext(): AudioContext | null {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.audioCtx = new Ctor();
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  enqueue(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.stopped = false;
    this.queue.push(trimmed);
    void this.drain();
  }

  /** Interrupt playback and drop queued sentences. */
  stop() {
    this.queue = [];
    this.stopped = true;
    this.stopSpectrum();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }

  private stopSpectrum() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    try {
      this.spectrumSource?.disconnect();
      this.spectrumAnalyser?.disconnect();
    } catch {
      /* already torn down */
    }
    this.spectrumSource = null;
    this.spectrumAnalyser = null;
    if (this.onSpectrum) {
      this.onSpectrum(emptySpectrum());
    }
  }

  private startSpectrum(element: HTMLAudioElement) {
    this.stopSpectrum();
    const ctx = this.ensureContext();
    if (!ctx) return;

    let source: MediaElementAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      source = ctx.createMediaElementSource(element);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (error) {
      // Analysis is optional: on failure leave normal playback untouched.
      void logError("tts_spectrum", error);
      return;
    }
    this.spectrumSource = source;
    this.spectrumAnalyser = analyser;

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const usable = Math.max(
      SPECTRUM_BARS,
      Math.floor(bins.length / 4),
    );
    const step = Math.max(1, Math.floor(usable / SPECTRUM_BARS));
    const tick = () => {
      analyser.getByteFrequencyData(bins);
      const values = new Array<number>(SPECTRUM_BARS);
      for (let i = 0; i < SPECTRUM_BARS; i += 1) {
        let sum = 0;
        for (let j = 0; j < step; j += 1) {
          sum += bins[i * step + j] ?? 0;
        }
        values[i] = Math.min(1, (sum / step / 255) * 1.9);
      }
      this.onSpectrum?.(values);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private async drain() {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next === undefined || this.stopped) break;
        try {
          const payload = await speak(next);
          if (this.stopped) break;
          await this.play(payload.base64, payload.mime);
        } catch (error) {
          void logError("tts_synthesis", error);
        }
      }
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.onIdle?.();
      }
    }
  }

  private play(base64: string, mime: string): Promise<void> {
    return new Promise((resolve) => {
      const element = new Audio(`data:${mime};base64,${base64}`);
      this.audio = element;
      this.onStart?.();
      this.startSpectrum(element);

      const finish = () => {
        this.stopSpectrum();
        if (this.audio === element) {
          this.audio = null;
        }
        resolve();
      };

      element.onended = finish;
      element.onerror = () => {
        // Stopping playback clears `src`, which fires a MEDIA_ELEMENT_ERROR
        // that is not a real failure.
        if (this.stopped || this.audio !== element || !element.getAttribute("src")) {
          finish();
          return;
        }
        const mediaError = element.error;
        void logError(
          "tts_playback",
          mediaError
            ? new Error(
                `code=${mediaError.code} message=${mediaError.message}`,
              )
            : "Audio playback failed",
        );
        finish();
      };
      void element.play().catch((error: unknown) => {
        const name = (error as { name?: string } | null)?.name;
        // Stopping playback aborts the play promise, and the startup greeting
        // can be blocked by the autoplay policy; neither is a real failure.
        if (this.stopped || name === "AbortError" || name === "NotAllowedError") {
          finish();
          return;
        }
        void logError("tts_playback", error);
        finish();
      });
    });
  }
}
