//! Lightweight audio preprocessing for speech recognition.
//!
//! The recorder already asks WebView2 for noise suppression and AGC, but that
//! is not applied consistently across microphones. This module runs a small
//! DSP chain on the WAV before it reaches speech.cpp or whisper.cpp:
//!
//! 1. DC offset removal
//! 2. high-pass (rumble) and low-pass (hiss) filtering
//! 3. noise gate driven by an estimated noise floor
//! 4. per-frame loudness normalization (AGC) with a safety limiter

use std::f32::consts::PI;

/// Process a 16-bit mono WAV and return a new WAV with the same sample rate.
pub fn process_wav(wav: &[u8], denoise: bool, normalize: bool) -> Result<Vec<u8>, String> {
    let (pcm, rate) = crate::speech::stt::wav_pcm(wav)?;
    let mut samples: Vec<f32> = pcm
        .chunks_exact(2)
        .map(|frame| i16::from_le_bytes([frame[0], frame[1]]) as f32 / 32768.0)
        .collect();
    if samples.len() < 64 {
        return Ok(wav.to_vec());
    }

    process(&mut samples, rate as f32, denoise, normalize);
    Ok(encode_wav(&samples, rate))
}

fn process(samples: &mut [f32], sample_rate: f32, denoise: bool, normalize: bool) {
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    for sample in samples.iter_mut() {
        *sample -= mean;
    }

    if denoise {
        high_pass(samples, sample_rate, 90.0);
        low_pass(samples, sample_rate, (sample_rate * 0.45).min(7000.0));
    }

    let frame = ((sample_rate / 100.0) as usize).max(64);
    if samples.len() < frame * 4 {
        return;
    }

    let frame_rms = |chunk: &[f32]| {
        (chunk.iter().map(|sample| sample * sample).sum::<f32>() / chunk.len() as f32).sqrt()
    };

    // Estimate the steady noise floor from the quietest 20% of frames.
    let levels: Vec<f32> = samples
        .chunks_exact(frame)
        .map(frame_rms)
        .collect();
    if levels.is_empty() {
        return;
    }
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
        let rms = frame_rms(chunk);
        let gate_target = if denoise && rms < noise_floor * 1.7 {
            0.08
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
            let gated_rms = rms * gate;
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
        // Very quiet recordings get one final lift so the recognizer sees a
        // healthy level even when the microphone gain is low.
        let peak = samples
            .iter()
            .fold(0.0f32, |max, sample| max.max(sample.abs()));
        if peak > 1e-5 && peak < 0.12 {
            let scale = (0.35 / peak).min(6.0);
            for sample in samples.iter_mut() {
                *sample = (*sample * scale).clamp(-0.98, 0.98);
            }
        }
    }
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
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
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

    fn peak(wav: &[u8]) -> f32 {
        let (pcm, _) = crate::speech::stt::wav_pcm(wav).unwrap();
        pcm.chunks_exact(2)
            .map(|frame| {
                (i16::from_le_bytes([frame[0], frame[1]]) as f32 / 32768.0).abs()
            })
            .fold(0.0f32, f32::max)
    }

    fn rms(wav: &[u8], from: usize, to: usize) -> f32 {
        let (pcm, _) = crate::speech::stt::wav_pcm(wav).unwrap();
        let samples: Vec<f32> = pcm
            .chunks_exact(2)
            .map(|frame| i16::from_le_bytes([frame[0], frame[1]]) as f32 / 32768.0)
            .collect();
        let slice = &samples[from.min(samples.len())..to.min(samples.len())];
        (slice.iter().map(|s| s * s).sum::<f32>() / slice.len().max(1) as f32).sqrt()
    }

    #[test]
    fn quiet_recording_is_lifted() {
        const RATE: usize = 16_000;
        let samples: Vec<f32> = (0..RATE)
            .map(|index| {
                (2.0 * PI * 440.0 * index as f32 / RATE as f32).sin() * 0.01
            })
            .collect();
        let input = wav_from(&samples, RATE as u32);
        let output = process_wav(&input, false, true).unwrap();

        assert!(peak(&output) > peak(&input) * 2.0);
        let (_, out_rate) = crate::speech::stt::wav_pcm(&output).unwrap();
        assert_eq!(out_rate as usize, RATE);
    }

    #[test]
    fn noise_gate_reduces_steady_noise() {
        const RATE: usize = 16_000;
        let mut samples: Vec<f32> = (0..RATE)
            .map(|index| {
                let phase = index as f32 * 0.73;
                (phase.sin() * 0.003) + (phase * 1.7).sin() * 0.002
            })
            .collect();
        for index in RATE / 2..RATE {
            let phase = 2.0 * PI * 300.0 * index as f32 / RATE as f32;
            samples[index] += phase.sin() * 0.2;
        }
        let input = wav_from(&samples, RATE as u32);
        let output = process_wav(&input, true, false).unwrap();

        let input_noise = rms(&input, 0, RATE / 3);
        let output_noise = rms(&output, 0, RATE / 3);
        assert!(output_noise < input_noise * 0.6);
    }
}
