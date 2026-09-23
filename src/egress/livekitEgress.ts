import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * LiveKit Egress — Audio Output & Barge-In Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the WebSocket connection to the LiveKit server for:
 *  • Streaming PCM audio bytes OUT to the PSTN caller
 *  • Receiving VAD barge-in interruption signals from the telephony layer
 *  • Jitter buffer management for smooth playback
 *
 * This class is completely vertical-agnostic. It only deals with raw bytes.
 * Latency target: 30–50ms egress buffer sync (per architecture spec).
 *
 * Events emitted:
 *  • 'interruption'  — Caller barged in; orchestrator must cancel TTS generation
 *  • 'disconnected'  — LiveKit connection closed
 */
export class LiveKitEgress extends EventEmitter {
  private wsClient:        WebSocket | null = null;
  private isConnected:     boolean = false;
  private audioBuffer:     Buffer[] = [];
  private isPlayingAudio:  boolean = false;

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(roomUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocket(`${roomUrl}?access_token=${token}`);

      this.wsClient.on('open', () => {
        this.isConnected = true;
        console.log(`[LiveKitEgress] Connected to LiveKit room.`);
        resolve();
      });

      this.wsClient.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'vad_barge_in') {
            this.handleInterruption();
          }
        } catch {
          // Binary frame — not a control message
        }
      });

      this.wsClient.on('error', (err) => {
        console.error('[LiveKitEgress] WebSocket error:', err);
        reject(err);
      });

      this.wsClient.on('close', () => {
        this.isConnected = false;
        console.log('[LiveKitEgress] Disconnected from LiveKit.');
        this.emit('disconnected');
      });
    });
  }

  // ── Audio Egress ───────────────────────────────────────────────────────────

  /**
   * Pipes a PCM audio chunk from the TTS engine into the LiveKit WebSocket.
   * A jitter buffer queues frames to smooth out network variance.
   */
  sendAudio(pcmAudioBytes: Buffer): void {
    if (!this.isConnected || !this.wsClient) {
      console.warn('[LiveKitEgress] Cannot send audio — not connected.');
      return;
    }

    this.audioBuffer.push(pcmAudioBytes);
    this.isPlayingAudio = true;

    // Flush the buffer frame-by-frame to the WebSocket
    while (this.audioBuffer.length > 0) {
      const frame = this.audioBuffer.shift()!;
      this.wsClient.send(frame);
    }
  }

  /** Whether the AI is currently mid-sentence playing audio. */
  get isCurrentlySpeaking(): boolean {
    return this.isPlayingAudio && this.audioBuffer.length > 0;
  }

  /** Called by the TTS engine when it has finished speaking (no more tokens). */
  markPlaybackComplete(): void {
    this.isPlayingAudio = false;
  }

  // ── Barge-In Handler ───────────────────────────────────────────────────────

  /**
   * Triggered when Silero VAD detects the caller speaking over the AI.
   * Immediately clears the jitter buffer and notifies the orchestrator.
   */
  handleInterruption(): void {
    console.warn('[LiveKitEgress] ⚡ BARGE-IN — flushing buffer, halting playback.');
    this.audioBuffer   = [];  // Drop all pending frames
    this.isPlayingAudio = false;
    this.emit('interruption');
  }

  // ── Escalation ─────────────────────────────────────────────────────────────

  /**
   * Sends a SIP REFER command to transfer the caller to a live human agent.
   * @param sipUri  e.g. "sip:receptionist@clinic.example.com"
   */
  escalateToHuman(sipUri: string): void {
    if (!this.wsClient || !this.isConnected) return;
    console.log(`[LiveKitEgress] Escalating call via SIP REFER → ${sipUri}`);
    this.wsClient.send(JSON.stringify({ type: 'sip_refer', target: sipUri }));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  disconnect(): void {
    this.audioBuffer   = [];
    this.isPlayingAudio = false;
    this.isConnected   = false;
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.close();
    }
    this.wsClient = null;
    console.log('[LiveKitEgress] Cleaned up.');
  }
}
