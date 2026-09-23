import { Ollama } from 'ollama';
import { LLMProvider, Message, LLMResponseChunk } from './llmProvider';

export class OllamaProvider implements LLMProvider {
  private ollamaClient: Ollama;
  private modelName: string;

  constructor(modelName: string = 'llama3') {
    this.ollamaClient = new Ollama({ host: 'http://localhost:11434' });
    this.modelName = modelName;
  }

  async *generateStream(history: Message[], systemPrompt: string): AsyncIterable<LLMResponseChunk> {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    try {
      const response = await this.ollamaClient.chat({
        model: this.modelName,
        messages: messages,
        stream: true,
      });

      for await (const chunk of response) {
        yield {
          text: chunk.message.content,
          isDone: chunk.done
        };
      }
    } catch (error) {
      console.error("Ollama Generation Error:", error);
      throw error;
    }
  }
}
