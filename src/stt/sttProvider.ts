/**
 * STT Provider Interface
 * Abstracts over Deepgram Nova-2 (Global), Sarvam Saaras (Indic), and
 * any future self-hosted Faster-Whisper implementation.
 */

export type STTLanguage =
  | 'en-IN' // English (India)
  | 'en-US' // English (US)
  | 'hi-IN' // Hindi
  | 'ta-IN' // Tamil
  | 'te-IN' // Telugu
  | 'kn-IN' // Kannada
  | 'ml-IN' // Malayalam
  | 'mr-IN' // Marathi
  | 'gu-IN' // Gujarati
  | 'bn-IN'; // Bengali

export interface TranscriptResult {
  text:         string;
  isFinal:      boolean;  // true = utterance complete; false = interim/partial
  confidence?:  number;   // 0.0 – 1.0
  languageCode?: STTLanguage;
}

export interface STTProvider {
  /**
   * Open a streaming WebSocket connection to the STT provider.
   */
  connect(languageCode?: STTLanguage): Promise<void>;

  /**
   * Push raw PCM audio bytes (from the telephony layer) into the STT stream.
   * @param audioChunk Raw PCM audio buffer (8kHz or 16kHz depending on provider config)
   */
  sendAudio(audioChunk: Buffer): void;

  /**
   * Register a callback that fires on every partial or final transcript.
   */
  onTranscript(callback: (result: TranscriptResult) => void): void;

  /**
   * Close the STT WebSocket connection cleanly.
   */
  disconnect(): void;
}
