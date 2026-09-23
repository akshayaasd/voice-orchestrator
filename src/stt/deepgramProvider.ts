import WebSocket from 'ws';
import type { STTProvider, STTLanguage, TranscriptResult } from './sttProvider';

/**
 * Deepgram Nova-2 streaming STT provider.
 * Uses the Deepgram WebSocket API directly — compatible with any SDK version.
 * Best for: Global English (en-IN, en-US), high-accuracy, low latency.
 * Latency budget: ~100–140ms (per architecture spec).
 *
 * Deepgram WebSocket docs:
 * https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
 */
export class DeepgramSTTProvider implements STTProvider {
  private apiKey:             string;
  private wsClient:           WebSocket | null = null;
  private transcriptCallback?: (result: TranscriptResult) => void;
  private activeLanguage:     STTLanguage = 'en-IN';

  private static readonly WS_BASE = 'wss://api.deepgram.com/v1/listen';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(languageCode: STTLanguage = 'en-IN'): Promise<void> {
    this.activeLanguage = languageCode;

    const params = new URLSearchParams({
      model:           'nova-2',
      language:        languageCode,
      smart_format:    'true',
      interim_results: 'true',
      encoding:        'linear16',
      sample_rate:     '8000',
      channels:        '1',
    });

    const url = `${DeepgramSTTProvider.WS_BASE}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocket(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });

      this.wsClient.on('open', () => {
        console.log('[DeepgramSTT] WebSocket connected.');
        resolve();
      });

      this.wsClient.on('message', (data: Buffer) => {
        try {
          const json = JSON.parse(data.toString()) as {
            channel?: { alternatives?: Array<{ transcript: string; confidence: number }> };
            is_final?: boolean;
            type?: string;
          };
          if (json.type === 'Results') {
            const alt = json.channel?.alternatives?.[0];
            if (!alt?.transcript) return;

            const result: TranscriptResult = {
              text:         alt.transcript,
              isFinal:      json.is_final ?? false,
              confidence:   alt.confidence,
              languageCode: this.activeLanguage,
            };
            console.log(`[DeepgramSTT] ${result.isFinal ? 'FINAL' : 'partial'}: "${result.text}"`);
            this.transcriptCallback?.(result);
          }
        } catch {
          // Non-JSON control frame — ignore
        }
      });

      this.wsClient.on('error', (err: Error) => {
        console.error('[DeepgramSTT] Error:', err);
        reject(err);
      });

      this.wsClient.on('close', () => {
        console.log('[DeepgramSTT] Connection closed.');
      });
    });
  }

  sendAudio(audioChunk: Buffer): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      console.warn('[DeepgramSTT] Cannot send audio — not connected.');
      return;
    }
    this.wsClient.send(audioChunk);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.transcriptCallback = callback;
  }

  disconnect(): void {
    console.log('[DeepgramSTT] Disconnecting...');
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.close();
    }
    this.wsClient = null;
  }
}
