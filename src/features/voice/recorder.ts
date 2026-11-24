const TARGET_RATE = 16_000;

export interface RecordedAudio {
  base64: string;
  durationMs: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunk),
    );
  }
  return btoa(binary);
}

function downsample(
  input: Float32Array,
  from: number,
  to: number,
): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Microphone capture with a live RMS level for voice activity detection.
 * Produces 16 kHz mono 16-bit PCM WAV, which whisper.cpp accepts directly.
 */
export class MicRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silence: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48_000;
  private startedAt = 0;

  get active(): boolean {
    return this.context !== null;
  }

  get durationMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    if (this.context) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("この環境ではマイクを利用できません");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const context = new AudioContext();
    this.context = context;
    this.sampleRate = context.sampleRate;

    const source = context.createMediaStreamSource(this.stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;

    const processor = context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(channel));
    };

    const silence = context.createGain();
    silence.gain.value = 0;

    source.connect(analyser);
    analyser.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);

    this.analyser = analyser;
    this.processor = processor;
    this.silence = silence;
    this.startedAt = performance.now();
  }

  level(): number {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /** Stop capture and return the encoded WAV recording. */
  async stop(): Promise<RecordedAudio | null> {
    const durationMs = this.durationMs;
    const chunks = this.chunks;
    const sampleRate = this.sampleRate;

    this.release();
    this.chunks = [];

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) return null;

    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const resampled = downsample(merged, sampleRate, TARGET_RATE);
    const wav = encodeWav(resampled, TARGET_RATE);

    return { base64: bytesToBase64(wav), durationMs };
  }

  cancel() {
    this.release();
    this.chunks = [];
  }

  private release() {
    this.processor?.disconnect();
    this.silence?.disconnect();
    this.analyser?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);

    this.processor = null;
    this.silence = null;
    this.analyser = null;
    this.stream = null;
    this.context = null;
    this.startedAt = 0;
  }
}
