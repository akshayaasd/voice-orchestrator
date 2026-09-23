import { GoogleGenerativeAI, Content, Part, FunctionDeclaration } from '@google/generative-ai';
import { LLMProvider, Message, LLMResponseChunk } from './llmProvider';

/**
 * Google Gemini 1.5 Flash LLM Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Tier 2 stack choice — ultra-low cost (₹0.05/min) with strong multilingual
 * performance for Indic languages. Supports native function calling.
 * Time-to-first-token target: 120–180ms (per architecture latency budget).
 */
export class GeminiProvider implements LLMProvider {
  private genAI:     GoogleGenerativeAI;
  private modelName: string;
  private tools:     FunctionDeclaration[];

  constructor(
    apiKey:    string,
    modelName: string = 'gemini-1.5-flash-latest',
    tools:     FunctionDeclaration[] = [],
  ) {
    this.genAI     = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
    this.tools     = tools;
  }

  async *generateStream(history: Message[], systemPrompt: string): AsyncIterable<LLMResponseChunk> {
    const model = this.genAI.getGenerativeModel({
      model:             this.modelName,
      systemInstruction: systemPrompt,
      ...(this.tools.length > 0 && { tools: [{ functionDeclarations: this.tools }] }),
    });

    // Convert our Message format to Gemini's Content format
    const contents: Content[] = history.map((msg) => {
      const geminiRole = msg.role === 'assistant' ? 'model'
        : msg.role === 'tool'      ? 'function'
        : 'user';

      return {
        role:  geminiRole as 'user' | 'model',
        parts: [{ text: msg.content } as Part],
      };
    });

    try {
      const result = await model.generateContentStream({ contents });

      for await (const chunk of result.stream) {
        // Extract text tokens
        let text: string | undefined;
        try { text = chunk.text(); } catch { /* No text in this chunk */ }

        if (text) {
          yield { text, isDone: false };
        }

        // Extract function calls
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const toolCalls = parts
          .filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } =>
            p.functionCall != null,
          )
          .map((p) => ({
            name:      p.functionCall.name,
            arguments: p.functionCall.args as Record<string, unknown>,
          }));

        if (toolCalls.length > 0) {
          yield { toolCalls, isDone: false };
        }
      }

      yield { isDone: true };
    } catch (error) {
      console.error('[GeminiProvider] Stream error:', error);
      throw error;
    }
  }
}
