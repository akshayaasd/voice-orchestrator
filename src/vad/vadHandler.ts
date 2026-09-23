import { EventEmitter } from 'events';

/**
 * VAD (Voice Activity Detection) Event Handler
 *
 * In the full pipeline, Silero VAD (ONNX model running at 40ms windows)
 * runs inside Keerthana's telephony ingress layer and emits events over
 * an internal EventEmitter or WebSocket.
 *
 * This module:
 *  1. Receives VAD signals (speech_start, speech_end, barge_in).
 *  2. Translates them into orchestrator-level events.
 *  3. Drives the barge-in flush → TTS cancel → STT restart cycle.
 *
 * Latency budget: <50ms from audio frame to VAD event emission.
 */

export type VADEvent = 'speech_start' | 'speech_end' | 'barge_in';

export class VADHandler extends EventEmitter {
  private isSpeaking:      boolean = false;
  private silenceThreshMs: number;
  private silenceTimer:    NodeJS.Timeout | null = null;

  /**
   * @param silenceThreshMs  How many ms of silence before speech_end fires (default 400ms)
   */
  constructor(silenceThreshMs: number = 400) {
    super();
    this.silenceThreshMs = silenceThreshMs;
  }

  /**
   * Feed raw Silero VAD probability score for the current 40ms audio frame.
   * Silero returns a value 0.0–1.0. Treat > 0.5 as "voice active".
   *
   * @param speechProbability Float 0.0–1.0 from the ONNX model output
   * @param isAICurrentlySpeaking Whether the AI is currently playing TTS audio
   */
  public processProbability(speechProbability: number, isAICurrentlySpeaking: boolean): void {
    const isVoiceActive = speechProbability > 0.5;

    if (isVoiceActive && !this.isSpeaking) {
      // Rising edge → speech started
      this.clearSilenceTimer();
      this.isSpeaking = true;
      console.log('[VAD] speech_start detected');
      this.emit('speech_start');

      // If the AI is mid-sentence, this is a BARGE-IN — highest priority
      if (isAICurrentlySpeaking) {
        console.warn('[VAD] BARGE-IN detected — user interrupted AI playback');
        this.emit('barge_in');
      }
    } else if (!isVoiceActive && this.isSpeaking) {
      // Falling edge → start silence timer
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this.isSpeaking = false;
          this.silenceTimer = null;
          console.log('[VAD] speech_end detected (silence threshold reached)');
          this.emit('speech_end');
        }, this.silenceThreshMs);
      }
    }
  }

  /**
   * Directly inject a VAD event from an external source
   * (e.g., from a LiveKit data message or SIP event).
   */
  public injectEvent(event: VADEvent): void {
    console.log(`[VAD] Injected external event: ${event}`);
    this.emit(event);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Reset state — called when a new call session starts.
   */
  public reset(): void {
    this.clearSilenceTimer();
    this.isSpeaking = false;
  }
}
