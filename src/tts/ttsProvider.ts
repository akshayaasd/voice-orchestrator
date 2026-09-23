export type SupportedLanguage = 'en-IN' | 'hi-IN' | 'ta-IN';

export interface TTSProvider {
  /**
   * Initializes the WebSocket connection to the TTS provider.
   */
  connect(): Promise<void>;

  /**
   * Streams a chunk of text to the TTS provider.
   * @param text A sentence or phrase to be synthesized
   * @param languageCode The ISO language code (e.g., 'en-IN', 'hi-IN', 'ta-IN')
   */
  streamText(text: string, languageCode?: SupportedLanguage): void;

  /**
   * Flushes the current synthesis buffer (useful for barge-in/interruption).
   */
  flush(): void;

  /**
   * Closes the connection to the TTS provider.
   */
  disconnect(): void;

  /**
   * Event listener for receiving audio bytes from the provider.
   */
  onAudio(callback: (audioBuffer: Buffer) => void): void;
}
