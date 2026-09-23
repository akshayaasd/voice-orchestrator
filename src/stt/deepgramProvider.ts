import WebSocket from 'ws';
import { STTProvider, STTLanguage, TranscriptResult } from './sttProvider';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

/**
 * Deepgram Nova-2 streaming STT provider.
 * Best for: Global English (en-IN, en-US), high-accuracy, low latency.
 * Latency budget: ~100–140ms (per architecture spec).
 */
export class DeepgramSTTProvider implements STTProvider {
  private apiKey: string;
  private connection: ReturnType<ReturnType<typeof createClient>['listen']['live']> | null = null;
  private transcriptCallback?: (result: TranscriptResult) => void;
  private deepgramClient: ReturnType<typeof createClient>;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.deepgramClient = createClient(this.apiKey);
  }

  async connect(languageCode: STTLanguage = 'en-IN'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = this.deepgramClient.listen.live({
        model:           'nova-2',
        language:        languageCode,
        smart_format:    true,
        interim_results: true,
        encoding:        'linear16',
        sample_rate:     8000,
        channels:        1,
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('[DeepgramSTT] WebSocket connection opened.');
        resolve();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const alt = data.channel?.alternatives?.[0];
        if (!alt?.transcript) return;

        const result: TranscriptResult = {
          text:         alt.transcript,
          isFinal:      data.is_final ?? false,
          confidence:   alt.confidence,
          languageCode,
        };

        console.log(`[DeepgramSTT] ${result.isFinal ? 'FINAL' : 'partial'}: "${result.text}"`);
        this.transcriptCallback?.(result);
      });

      this.connection.on(LiveTranscriptionEvents.Error, (err) => {
        console.error('[DeepgramSTT] Error:', err);
        reject(err);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('[DeepgramSTT] Connection closed.');
      });
    });
  }

  sendAudio(audioChunk: Buffer): void {
    if (!this.connection) {
      console.warn('[DeepgramSTT] Cannot send audio — not connected.');
      return;
    }
    this.connection.send(audioChunk);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.transcriptCallback = callback;
  }

  disconnect(): void {
    console.log('[DeepgramSTT] Disconnecting...');
    this.connection?.finish();
    this.connection = null;
  }
}
