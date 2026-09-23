import WebSocket from 'ws';
import { TTSProvider, SupportedLanguage } from './ttsProvider';

/**
 * Sarvam Bulbul Streaming TTS Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends text chunks over a WebSocket and receives raw PCM audio bytes back.
 * This audio is then piped into LiveKitEgress for telephony playback.
 *
 * Latency target: 90–130ms for first audio chunk (per architecture spec).
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 */
export class SarvamTTSProvider implements TTSProvider {
  private apiKey:           string;
  private wsClient:         WebSocket | null = null;
  private isConnected:      boolean = false;
  private audioCallback?:   (audioBuffer: Buffer) => void;

  private static readonly WS_URL = 'wss://api.sarvam.ai/text-to-speech/streaming';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocket(SarvamTTSProvider.WS_URL, {
        headers: { 'api-subscription-key': this.apiKey },
      });

      this.wsClient.on('open', () => {
        this.isConnected = true;
        console.log('[SarvamTTS] WebSocket connected to Bulbul.');
        resolve();
      });

      this.wsClient.on('message', (data: Buffer) => {
        // Sarvam streams back binary PCM audio frames
        if (Buffer.isBuffer(data) && this.audioCallback) {
          this.audioCallback(data);
        }
      });

      this.wsClient.on('error', (err) => {
        console.error('[SarvamTTS] WebSocket error:', err);
        reject(err);
      });

      this.wsClient.on('close', () => {
        this.isConnected = false;
        console.log('[SarvamTTS] WebSocket closed.');
      });
    });
  }

  streamText(text: string, languageCode: SupportedLanguage = 'en-IN'): void {
    if (!this.isConnected || !this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      console.warn('[SarvamTTS] Cannot stream text — not connected.');
      return;
    }
    console.log(`[SarvamTTS] → Streaming [${languageCode}]: "${text}"`);
    this.wsClient.send(JSON.stringify({
      text,
      language_code: languageCode,
      speaker:       'meera', // Default Indic voice
      model:         'bulbul:v1',
    }));
  }

  flush(): void {
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      console.log('[SarvamTTS] Flushing buffer — barge-in detected.');
      this.wsClient.send(JSON.stringify({ action: 'flush' }));
    }
  }

  disconnect(): void {
    console.log('[SarvamTTS] Disconnecting...');
    this.isConnected = false;
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.close();
    }
    this.wsClient = null;
  }

  onAudio(callback: (audioBuffer: Buffer) => void): void {
    this.audioCallback = callback;
  }
}
