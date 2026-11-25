//! Audio preprocessing for speech recognition.
//!
//! Pipeline: DC removal → high/low-pass → RNNoise (or classic gate) →
//! energy-based speech trimming → loudness normalization (AGC).
//!
//! The recorder produces 16 kHz mono PCM. RNNoise expects 48 kHz, so the
//! signal is resampled up, denoised, and resampled back.

use std::f32::consts::PI;

#[derive(Debug, Clone, Copy, Default)]
pub struct AudioMetrics {
    pub sample_rate: u32,
    pub duration_ms: u32,
    pub input_peak: f32,
    pub input_rms: f32,
    pub output_peak: f32,
    pub output_rms: f32,
    /// Fraction of 10 ms frames considered voiced.
    pub speech_ratio: f32,
}

impl AudioMetrics {
    pub fn summary(&self) -> String {
        format!(
            "rate={} dur={}ms in_peak={:.3} in_rms={:.4} out_peak={:.3} out_rms={:.4} speech={:.2}",
            self.sample_rate,
            self.duration_ms,
            self.input_peak,
            self.input_rms,
            self.output_peak,
            self.output_rms,
            self.speech_ratio
        )
    }
}

/// Metrics for a WAV without modifying it.
pub fn wav_metrics(wav: &[u8]) -> Result<AudioMetrics, String> {
    let (pcm, rate) = crate::speech::stt::wav_pcm(wav)?;
    let samples = decode(&pcm);
    Ok(analyze(&samples, rate))
}

/// Process a 16-bit mono WAV and return the new WAV plus quality metrics.
pub fn process_wav(
    wav: &[u8],
    denoise: bool,
    normalize: bool,
    engine: &str,
) -> Result<(Vec<u8>, AudioMetrics), String> {
    let (pcm, rate) = crate::speech::stt::wav_pcm(wav)?;
    let mut samples = decode(&pcm);
    if samples.len() < 64 {
        let metrics = analyze(&samples, rate);
        return Ok((wav.to_vec(), metrics));
    }

    let mut metrics = analyze(&samples, rate);
    process(&mut samples, rate as f32, denoise, normalize, engine);
    metrics.output_peak = peak(&samples);
    metrics.output_rms = rms(&samples);
    metrics.speech_ratio = speech_ratio(&samples, rate as f32);
    Ok((encode_wav(&samples, rate), metrics))
}

fn decode(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(2)
        .map(|frame| i16::from_le_bytes([frame[0], frame[1]]) as f32 / 32768.0)
        .collect()
}

fn analyze(samples: &[f32], rate: u32) -> AudioMetrics {
    AudioMetrics {
        sample_rate: rate,
        duration_ms: ((samples.len() as f32 / rate.max(1) as f32) * 1000.0) as u32,
        input_peak: peak(samples),
        input_rms: rms(samples),
        output_peak: 0.0,
        output_rms: 0.0,
        speech_ratio: speech_ratio(samples, rate as f32),
    }
}

fn peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0f32, |max, sample| max.max(sample.abs()))
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

fn frame_len(sample_rate: f32) -> usize {
    ((sample_rate / 100.0) as usize).max(64)
}

fn speech_ratio(samples: &[f32], sample_rate: f32) -> f32 {
    let frame = frame_len(sample_rate);
    let levels: Vec<f32> = samples
        .chunks_exact(frame)
        .map(rms)
        .collect();
    if levels.is_empty() {
        return 0.0;
    }
    let mut sorted = levels.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let noise = sorted[sorted.len() / 5].max(1e-6);
    let threshold = (noise * 2.2).max(0.004);
    let voiced = levels.iter().filter(|level| **level >= threshold).count();
    voiced as f32 / levels.len() as f32
}

fn process(
    samples: &mut Vec<f32>,
    sample_rate: f32,
    denoise: bool,
    normalize: bool,
    engine: &str,
) {
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    for sample in samples.iter_mut() {
        *sample -= mean;
    }

    if denoise {
        high_pass(samples, sample_rate, 90.0);
        low_pass(samples, sample_rate, (sample_rate * 0.45).min(7000.0));
        if engine == "rnnoise" {
            rnnoise(samples, sample_rate);
        }
    }

    // Trim leading/trailing silence based on an energy VAD.
    let frame = frame_len(sample_rate);
    if samples.len() > frame * 6 {
        let levels: Vec<f32> = samples.chunks_exact(frame).map(rms).collect();
        let mut sorted = levels.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let noise = sorted[sorted.len() / 5].max(1e-6);
        let threshold = (noise * 2.2).max(0.004);
        let mut first = None;
        let mut last = 0;
        for (index, level) in levels.iter().enumerate() {
            if *level >= threshold {
                if first.is_none() {
                    first = Some(index);
                }
                last = index;
            }
        }
        if let Some(start) = first {
            let pad = 6;
            let begin = start.saturating_sub(pad) * frame;
            let end = ((last + 1 + pad) * frame).min(samples.len());
            if end > begin {
                samples.drain(end..);
                samples.drain(..begin);
            }
        }
    }

    let frame = frame_len(sample_rate);
    if samples.len() < frame * 4 {
        return;
    }

    let levels: Vec<f32> = samples.chunks_exact(frame).map(rms).collect();
    let mut sorted = levels.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let noise_floor = sorted[sorted.len() / 5].max(1e-6);

    let gate_attack = frame_coef(0.004, sample_rate, frame);
    let gate_release = frame_coef(0.150, sample_rate, frame);
    let agc_fast = frame_coef(0.010, sample_rate, frame);
    let agc_slow = frame_coef(0.350, sample_rate, frame);

    let mut gate = 1.0f32;
    let mut agc = 1.0f32;
    let target_rms = 0.08f32;

    for chunk in samples.chunks_mut(frame) {
        let level = rms(chunk);
        let gate_target = if denoise && level < noise_floor * 1.7 {
            0.10
        } else {
            1.0
        };
        let gate_step = if gate_target < gate {
            gate_attack
        } else {
            gate_release
        };
        gate += (gate_target - gate) * gate_step;

        if normalize {
            let gated_rms = level * gate;
            let desired = if gated_rms < noise_floor * 0.9 {
                agc
            } else {
                (target_rms / gated_rms.max(1e-4)).clamp(0.7, 5.0)
            };
            let agc_step = if desired < agc { agc_fast } else { agc_slow };
            agc += (desired - agc) * agc_step;
        }

        let gain = gate * agc;
        for sample in chunk.iter_mut() {
            *sample = (*sample * gain).clamp(-0.98, 0.98);
        }
    }

    if normalize {
        let current_peak = peak(samples);
        if current_peak > 1e-5 && current_peak < 0.12 {
            let scale = (0.35 / current_peak).min(6.0);
            for sample in samples.iter_mut() {
                *sample = (*sample * scale).clamp(-0.98, 0.98);
            }
        }
    }
}

/// RNNoise operates on 48 kHz frames of 480 samples in i16 range.
fn rnnoise(samples: &mut Vec<f32>, sample_rate: f32) {
    if samples.len() < 480 {
        return;
    }
    let ratio = 48_000.0 / sample_rate.max(1.0);
    let up_len = (samples.len() as f32 * ratio).ceil() as usize;
    let mut up = Vec::with_capacity(up_len + 480);
    for index in 0..up_len {
        let position = index as f32 / ratio;
        let base = position.floor() as usize;
        let fraction = position - base as f32;
        let a = samples[base.min(samples.len() - 1)];
        let b = samples[(base + 1).min(samples.len() - 1)];
        up.push((a + (b - a) * fraction) * 32768.0);
    }

    let mut state = nnnoiseless::DenoiseState::new();
    let mut output = [0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
    let mut input = [0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
    // RNNoise fades in on its first frame; feed silence first and discard it.
    state.process_frame(&mut output, &input);

    let mut denoised = Vec::with_capacity(up.len());
    for chunk in up.chunks(nnnoiseless::DenoiseState::FRAME_SIZE) {
        input = [0.0; nnnoiseless::DenoiseState::FRAME_SIZE];
        input[..chunk.len()].copy_from_slice(chunk);
        state.process_frame(&mut output, &input);
        denoised.extend_from_slice(&output);
    }

    let original_len = samples.len();
    for (index, sample) in samples.iter_mut().enumerate() {
        let position = index as f32 * ratio;
        let base = position.floor() as usize;
        let fraction = position - base as f32;
        let a = denoised.get(base).copied().unwrap_or(0.0);
        let b = denoised.get(base + 1).copied().unwrap_or(a);
        *sample = (a + (b - a) * fraction) / 32768.0;
    }
    samples.truncate(original_len);
}

fn frame_coef(seconds: f32, sample_rate: f32, frame: usize) -> f32 {
    let duration = frame as f32 / sample_rate;
    1.0 - (-duration / seconds.max(1e-4)).exp()
}

fn high_pass(samples: &mut [f32], sample_rate: f32, cutoff: f32) {
    let a = (-2.0 * PI * cutoff / sample_rate).exp();
    let mut previous_input = 0.0f32;
    let mut previous_output = 0.0f32;
    for sample in samples.iter_mut() {
        let input = *sample;
        let output = a * (previous_output + input - previous_input);
        previous_input = input;
        previous_output = output;
        *sample = output;
    }
}

fn low_pass(samples: &mut [f32], sample_rate: f32, cutoff: f32) {
    let a = (-2.0 * PI * cutoff / sample_rate).exp();
    let mut previous = 0.0f32;
    for sample in samples.iter_mut() {
        previous = (1.0 - a) * *sample + a * previous;
        *sample = previous;
    }
}

fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut wav = Vec::with_capacity(44 + data_len);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        wav.extend_from_slice(&value.to_le_bytes());
    }
    wav
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_from(samples: &[f32], rate: u32) -> Vec<u8> {
        encode_wav(samples, rate)
    }

    fn peak_of(wav: &[u8]) -> f32 {
        let (pcm, _) = crate::speech::stt::wav_pcm(wav).unwrap();
        decode(&pcm)
            .iter()
            .fold(0.0f32, |max, sample| max.max(sample.abs()))
    }

    fn rms_of(wav: &[u8], from: usize, to: usize) -> f32 {
        let (pcm, _) = crate::speech::stt::wav_pcm(wav).unwrap();
        let samples = decode(&pcm);
        rms(&samples[from.min(samples.len())..to.min(samples.len())])
    }

    #[test]
    fn quiet_recording_is_lifted() {
        const RATE: usize = 16_000;
        let samples: Vec<f32> = (0..RATE)
            .map(|index| (2.0 * PI * 440.0 * index as f32 / RATE as f32).sin() * 0.01)
            .collect();
        let input = wav_from(&samples, RATE as u32);
        let (output, metrics) = process_wav(&input, false, true, "classic").unwrap();

        assert!(peak_of(&output) > peak_of(&input) * 2.0);
        assert!(metrics.output_peak >= metrics.input_peak);
        let (_, out_rate) = crate::speech::stt::wav_pcm(&output).unwrap();
        assert_eq!(out_rate as usize, RATE);
    }

    #[test]
    fn noise_gate_reduces_steady_noise() {
        const RATE: usize = 16_000;
        let samples: Vec<f32> = (0..RATE)
            .map(|index| {
                let phase = index as f32 * 0.73;
                (phase.sin() * 0.01) + (phase * 1.7).sin() * 0.008
            })
            .collect();
        let input = wav_from(&samples, RATE as u32);
        let (output, _) = process_wav(&input, true, false, "classic").unwrap();

        let input_noise = rms_of(&input, 0, RATE);
        let output_noise = rms_of(&output, 0, RATE);
        assert!(output_noise < input_noise * 0.6);
    }

    #[test]
    fn rnnoise_preserves_length_and_rate() {
        const RATE: usize = 16_000;
        let samples: Vec<f32> = (0..RATE)
            .map(|index| {
                let phase = 2.0 * PI * 220.0 * index as f32 / RATE as f32;
                phase.sin() * 0.2
            })
            .collect();
        let input = wav_from(&samples, RATE as u32);
        let (output, metrics) = process_wav(&input, true, false, "rnnoise").unwrap();
        let (pcm, rate) = crate::speech::stt::wav_pcm(&output).unwrap();

        assert_eq!(rate as usize, RATE);
        assert!((pcm.len() as i64 - input.len() as i64).abs() < 64);
        assert!(metrics.output_peak > 0.0);
    }
}
