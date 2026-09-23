export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolCall {
  name: string;
  /** Parsed JSON arguments from the LLM. Always validate before use. */
  arguments: Record<string, unknown>;
}

export interface LLMResponseChunk {
  text?: string;
  toolCalls?: ToolCall[];
  isDone: boolean;
}

export interface LLMProvider {
  /**
   * Generates a streaming response from the LLM based on the conversation history.
   * Allows the orchestrator to intercept text chunks for the TTS engine.
   * 
   * @param history The sliding window of conversation history
   * @param systemPrompt The vertical-specific system prompt to inject
   * @returns An async iterable yielding text chunks or tool call requests
   */
  generateStream(history: Message[], systemPrompt: string): AsyncIterable<LLMResponseChunk>;
}
