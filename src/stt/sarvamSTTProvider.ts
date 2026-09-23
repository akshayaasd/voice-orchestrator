import WebSocket from 'ws';
import { STTProvider, STTLanguage, TranscriptResult } from './sttProvider';

/**
 * Sarvam Saaras streaming STT provider.
 * Best for: Indic languages (Hindi, Tamil, Telugu, Kannada, etc.)
 * Latency budget: ~100–140ms (same as Deepgram per architecture spec).
 * Docs: https://docs.sarvam.ai/api-reference/speech-to-text
 */
export class SarvamSTTProvider implements STTProvider {
  private apiKey:             string;
  private wsClient:           WebSocket | null = null;
  private transcriptCallback?: (result: TranscriptResult) => void;
  private activeLanguage:     STTLanguage = 'hi-IN';

  // Sarvam Saaras WebSocket endpoint
  private static readonly WS_URL = 'wss://api.sarvam.ai/speech-to-text-translate/streaming';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(languageCode: STTLanguage = 'hi-IN'): Promise<void> {
    this.activeLanguage = languageCode;

    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocket(SarvamSTTProvider.WS_URL, {
        headers: {
          'api-subscription-key': this.apiKey,
        },
      });

      this.wsClient.on('open', () => {
        // Send initial config frame
        const config = {
          language_code: languageCode,
          encoding:      'linear16',
          sample_rate:   8000,
          model:         'saaras:v2',
        };
        this.wsClient!.send(JSON.stringify(config));
        console.log(`[SarvamSTT] Connected for language: ${languageCode}`);
        resolve();
      });

      this.wsClient.on('message', (data: Buffer) => {
        try {
          const json = JSON.parse(data.toString());
          const transcript = json.transcript ?? json.text ?? '';
          const isFinal    = json.is_final ?? json.speech_final ?? false;

          if (!transcript) return;

          const result: TranscriptResult = {
            text:         transcript,
            isFinal,
            confidence:   json.confidence,
            languageCode: this.activeLanguage,
          };

          console.log(`[SarvamSTT] ${result.isFinal ? 'FINAL' : 'partial'}: "${result.text}"`);
          this.transcriptCallback?.(result);
        } catch {
          // Non-JSON control frame — ignore
        }
      });

      this.wsClient.on('error', (err) => {
        console.error('[SarvamSTT] WebSocket error:', err);
        reject(err);
      });

      this.wsClient.on('close', () => {
        console.log('[SarvamSTT] Connection closed.');
      });
    });
  }

  sendAudio(audioChunk: Buffer): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      console.warn('[SarvamSTT] Cannot send audio — not connected.');
      return;
    }
    this.wsClient.send(audioChunk);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.transcriptCallback = callback;
  }

  disconnect(): void {
    console.log('[SarvamSTT] Disconnecting...');
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.close();
    }
    this.wsClient = null;
  }
}
