import { speak } from "../../lib/ipc/voice";
import { logError } from "../../lib/logging";

/**
 * Sequential TTS playback queue. Sentences are synthesized one at a time so
 * the assistant can start speaking before the reply has finished streaming.
 */
export class TtsPlayer {
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private audio: HTMLAudioElement | null = null;

  onStart: (() => void) | null = null;
  onIdle: (() => void) | null = null;

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
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
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

      const finish = () => {
        if (this.audio === element) {
          this.audio = null;
        }
        resolve();
      };

      element.onended = finish;
      element.onerror = () => {
        void logError("tts_playback", element.error ?? "Audio playback failed");
        finish();
      };
      void element.play().catch((error: unknown) => {
        void logError("tts_playback", error);
        finish();
      });
    });
  }
}
