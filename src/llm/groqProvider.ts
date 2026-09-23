import Groq from 'groq-sdk';
import { LLMProvider, Message, LLMResponseChunk } from './llmProvider';

/**
 * Groq Llama 3.3 70B LLM Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Tier 2 stack choice — ₹0.60/min, fastest inference of any hosted provider.
 * Groq's LPU hardware gives sub-100ms TTFT, making it the best choice for
 * aggressive sub-600ms total pipeline latency.
 */
export class GroqProvider implements LLMProvider {
  private client:    Groq;
  private modelName: string;
  private tools:     Groq.Chat.Completions.ChatCompletionTool[];

  constructor(
    apiKey:    string,
    modelName: string = 'llama-3.3-70b-versatile',
    tools:     Groq.Chat.Completions.ChatCompletionTool[] = [],
  ) {
    this.client    = new Groq({ apiKey });
    this.modelName = modelName;
    this.tools     = tools;
  }

  async *generateStream(history: Message[], systemPrompt: string): AsyncIterable<LLMResponseChunk> {
    const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => {
        if (m.role === 'tool') {
          return {
            role:         'tool' as const,
            content:      m.content,
            tool_call_id: 'tool-result', // placeholder — real ID from prior tool_call
          };
        }
        return {
          role:    m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        };
      }),
    ];

    // Accumulate tool call delta chunks (Groq streams tool calls incrementally)
    const pendingToolCalls: Map<number, { id: string; name: string; argsRaw: string }> = new Map();

    try {
      const stream = await this.client.chat.completions.create({
        model:    this.modelName,
        messages,
        stream:   true,
        ...(this.tools.length > 0 && { tools: this.tools }),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Text token
        if (delta.content) {
          yield { text: delta.content, isDone: false };
        }

        // Accumulate tool call fragments
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index) ?? {
              id:      tc.id ?? '',
              name:    tc.function?.name ?? '',
              argsRaw: '',
            };
            existing.argsRaw += tc.function?.arguments ?? '';
            pendingToolCalls.set(tc.index, existing);
          }
        }

        // When finish_reason is 'tool_calls', all fragments have arrived
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          const toolCalls = [...pendingToolCalls.values()].map((tc) => {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.argsRaw); } catch { /* leave empty */ }
            return { name: tc.name, arguments: args };
          });
          pendingToolCalls.clear();
          yield { toolCalls, isDone: false };
        }
      }

      yield { isDone: true };
    } catch (error) {
      console.error('[GroqProvider] Stream error:', error);
      throw error;
    }
  }
}
