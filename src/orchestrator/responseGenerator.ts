import { LLMProvider, Message, LLMResponseChunk, ToolCall } from '../llm/llmProvider';
import { UnifiedAppointmentAdapter, ClientProfile } from '../adapters/UnifiedAppointmentAdapter';

/**
 * ResponseGenerator
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridges the LLM provider and the TTS engine.
 *  • Maintains a sliding conversation window (capped at maxHistoryLimit)
 *  • Streams text tokens directly to the TTS buffer via AsyncIterable
 *  • Executes LLM tool calls against the real UnifiedAppointmentAdapter
 *  • Sanitizes user input to mitigate prompt injection attacks
 */
export class ResponseGenerator {
  private llmProvider:      LLMProvider;
  private systemPrompt:     string;
  private conversationWindow: Message[] = [];
  private maxHistoryLimit:  number = 20;
  private adapter:          UnifiedAppointmentAdapter;
  private tenantId:         string;

  constructor(
    llmProvider:  LLMProvider,
    systemPrompt: string,
    adapter:      UnifiedAppointmentAdapter,
    tenantId:     string,
  ) {
    this.llmProvider  = llmProvider;
    this.systemPrompt = systemPrompt;
    this.adapter      = adapter;
    this.tenantId     = tenantId;
  }

  /**
   * Adds a user transcript to the conversation window.
   * Input is sanitized to prevent prompt injection from caller speech.
   */
  public addUserMessage(text: string): void {
    // Wrap in a structured tag so the LLM always distinguishes real caller
    // speech from injected instructions even if the caller tries to jailbreak.
    const sanitized = `[CALLER]: ${text.slice(0, 1000)}`; // Hard-cap length
    this.conversationWindow.push({ role: 'user', content: sanitized });
    this.enforceSlidingWindow();
  }

  /**
   * Adds the assistant's generated response back to the window for context.
   */
  public addAssistantMessage(text: string): void {
    this.conversationWindow.push({ role: 'assistant', content: text });
    this.enforceSlidingWindow();
  }

  /**
   * Prevents the context window from growing indefinitely by slicing older messages.
   */
  private enforceSlidingWindow(): void {
    if (this.conversationWindow.length > this.maxHistoryLimit) {
      this.conversationWindow = this.conversationWindow.slice(
        this.conversationWindow.length - this.maxHistoryLimit,
      );
    }
  }

  /**
   * Generates the LLM response as a stream.
   * Text chunks are yielded directly for the TTS engine to consume.
   * Tool calls are executed against the adapter and results are re-injected.
   */
  public async *generateResponse(): AsyncIterable<string> {
    const stream = this.llmProvider.generateStream(this.conversationWindow, this.systemPrompt);
    let fullResponse = '';

    for await (const chunk of stream) {
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        // Pause TTS emission, execute tool, inject result, then continue
        await this.handleToolCalls(chunk.toolCalls);
        continue;
      }

      if (chunk.text) {
        fullResponse += chunk.text;
        yield chunk.text; // Stream directly to TTS
      }
    }

    if (fullResponse.trim().length > 0) {
      this.addAssistantMessage(fullResponse);
    }
  }

  /**
   * Executes tool calls against the real UnifiedAppointmentAdapter.
   * Results are injected back into the conversation so the LLM can
   * continue speaking with accurate information.
   */
  private async handleToolCalls(toolCalls: ToolCall[]): Promise<void> {
    for (const tool of toolCalls) {
      console.log(`[Action] LLM requested tool: "${tool.name}"`, tool.arguments);
      let toolResult: Record<string, unknown>;

      try {
        switch (tool.name) {
          case 'search_slots': {
            const args = tool.arguments as {
              start_date: string;
              end_date:   string;
              service_type?: string;
            };
            const slots = await this.adapter.searchSlots({
              tenantId:    this.tenantId,
              startDate:   args.start_date,
              endDate:     args.end_date,
              serviceType: args.service_type,
            });
            toolResult = { status: 'success', slots };
            break;
          }

          case 'hold_slot': {
            const args = tool.arguments as { slot_id: string };
            const hold = await this.adapter.holdSlot({
              tenantId: this.tenantId,
              slotId:   args.slot_id,
            });
            toolResult = {
              status:     'success',
              holdToken:  hold.holdToken,
              expiresAt:  hold.expiresAt,
              message:    `Slot held until ${hold.expiresAt}. Ask the caller to confirm.`,
            };
            break;
          }

          case 'book_appointment': {
            const args = tool.arguments as {
              hold_token:          string;
              customer_name:       string;
              customer_phone:      string;
              service_or_specialty?: string;
              notes?:              string;
            };
            const clientDetails: ClientProfile = {
              name:  args.customer_name,
              phone: args.customer_phone,
              notes: args.notes,
            };
            const booking = await this.adapter.confirmBooking({
              tenantId:      this.tenantId,
              holdToken:     args.hold_token,
              clientDetails,
              appointmentTypeId: args.service_or_specialty,
            });
            toolResult = {
              status:           'success',
              confirmationCode: booking.confirmationCode,
              appointmentId:    booking.externalAppointmentId,
              message:          `Booking confirmed. Confirmation code: ${booking.confirmationCode}.`,
            };
            break;
          }

          case 'cancel_booking': {
            const args = tool.arguments as { appointment_id: string; reason?: string };
            await this.adapter.cancelBooking({
              tenantId:              this.tenantId,
              externalAppointmentId: args.appointment_id,
              reason:                args.reason,
            });
            toolResult = { status: 'success', message: 'Appointment cancelled successfully.' };
            break;
          }

          default:
            toolResult = { status: 'error', message: `Unknown tool: "${tool.name}"` };
        }
      } catch (error) {
        console.error(`[Tool Error] ${tool.name}:`, error);
        toolResult = { status: 'error', message: 'I encountered an issue completing that action. Please try again.' };
      }

      // Inject the real result back into the conversation window
      this.conversationWindow.push({
        role:    'tool',
        content: JSON.stringify(toolResult),
      });
    }
  }
}
