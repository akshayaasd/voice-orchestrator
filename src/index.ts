import './config'; // Load .env first
import { config } from './config';

// ── Orchestrator ───────────────────────────────────────────────────────────────
import { CallStateMachine, CallState } from './orchestrator/stateMachine';
import { ResponseGenerator }           from './orchestrator/responseGenerator';

// ── LLM Providers ─────────────────────────────────────────────────────────────
import { OllamaProvider }   from './llm/ollamaProvider';
import { GeminiProvider }   from './llm/geminiProvider';
import { GroqProvider }     from './llm/groqProvider';

// ── System Prompts ─────────────────────────────────────────────────────────────
import { HEALTHCARE_SYSTEM_PROMPT } from './llm/prompts/healthcarePrompt';
import { SALON_SYSTEM_PROMPT }      from './llm/prompts/salonPrompt';
import { LEGAL_SYSTEM_PROMPT }      from './llm/prompts/legalPrompt';

// ── TTS ───────────────────────────────────────────────────────────────────────
import { SarvamTTSProvider } from './tts/sarvamProvider';

// ── Egress ─────────────────────────────────────────────────────────────────────
import { LiveKitEgress } from './egress/livekitEgress';

// ── Adapters ──────────────────────────────────────────────────────────────────
import { MockAppointmentAdapter } from './adapters/MockAppointmentAdapter';

// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER FACTORY
// ─────────────────────────────────────────────────────────────────────────────
function createLLMProvider() {
  if (config.llm.groqApiKey) {
    console.log('[Bootstrap] Using Groq Llama 3.3 70B (Tier 2 — fastest TTFT)');
    return new GroqProvider(config.llm.groqApiKey);
  }
  if (config.llm.geminiApiKey) {
    console.log('[Bootstrap] Using Gemini 1.5 Flash (Tier 2 — Indic support)');
    return new GeminiProvider(config.llm.geminiApiKey);
  }
  console.log('[Bootstrap] Using Ollama (local dev fallback)');
  return new OllamaProvider(config.llm.ollamaModel);
}

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL PROMPT SELECTOR
// ─────────────────────────────────────────────────────────────────────────────
type Vertical = 'healthcare' | 'salon' | 'legal';

function getSystemPrompt(vertical: Vertical): string {
  switch (vertical) {
    case 'healthcare': return HEALTHCARE_SYSTEM_PROMPT;
    case 'salon':      return SALON_SYSTEM_PROMPT;
    case 'legal':      return LEGAL_SYSTEM_PROMPT;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALL SESSION BOOTSTRAPPER (Akshayaa's core loop)
// ─────────────────────────────────────────────────────────────────────────────
async function bootstrapCallSession(params: {
  callSid:     string;
  tenantId:    string;
  callerPhone: string;
  vertical:    Vertical;
  language:    'en-IN' | 'hi-IN' | 'ta-IN';
}) {
  const { callSid, tenantId, callerPhone, vertical, language } = params;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Session] Starting call: ${callSid} | tenant: ${tenantId} | caller: ${callerPhone}`);
  console.log(`[Session] Vertical: ${vertical} | Language: ${language}`);
  console.log(`${'='.repeat(70)}\n`);

  // ── 1. State Machine ──────────────────────────────────────────────────────
  const fsm = new CallStateMachine(callSid, tenantId, callerPhone);
  fsm.transition(CallState.CALL_INIT);

  // ── 2. Appointment Adapter ────────────────────────────────────────────────
  const adapter = new MockAppointmentAdapter();

  // ── 3. LLM + Response Generator ───────────────────────────────────────────
  const llm              = createLLMProvider();
  const systemPrompt     = getSystemPrompt(vertical);
  const responseGen      = new ResponseGenerator(llm, systemPrompt, adapter, tenantId);

  // ── 4. TTS ────────────────────────────────────────────────────────────────
  const tts = new SarvamTTSProvider(config.tts.sarvamApiKey);
  if (config.tts.sarvamApiKey) {
    try {
      await tts.connect();
    } catch (err) {
      console.warn('[TTS] Connection failed (check API key) — TTS disabled for this session:', (err as Error).message);
    }
  } else {
    console.warn('[TTS] No Sarvam API key — skipping TTS connection.');
  }

  // ── 5. LiveKit Egress ─────────────────────────────────────────────────────
  const egress = new LiveKitEgress();
  // In production: egress.connect(livekitRoomUrl, roomToken)

  // ── 6. Wire TTS → Egress ──────────────────────────────────────────────────
  tts.onAudio((audioBytes) => {
    egress.sendAudio(audioBytes);
  });

  fsm.transition(CallState.CONTEXT_AND_IDENTITY);

  return { fsm, responseGen, tts, egress, adapter };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎙️  Voice Orchestrator (Akshayaa) — Starting up (${config.app.env})`);
  console.log(`🔑  LLM: ${config.llm.groqApiKey ? 'Groq' : config.llm.geminiApiKey ? 'Gemini' : 'Ollama (local)'}\n`);

  // ── Local Dev Demo ────────────────────────────────────────────────────────
  if (config.app.isDev) {
    console.log('\n[Demo] Running local dev session...\n');
    const session = await bootstrapCallSession({
      callSid:     `demo-${Date.now()}`,
      tenantId:    'tenant-demo',
      callerPhone: '+919876543210',
      vertical:    'healthcare',
      language:    'en-IN',
    });

    console.log('\n[Demo] Session bootstrapped successfully. FSM state:', session.fsm.currentState);
    console.log('[Demo] All Akshayaa components wired. Ready for audio input.\n');

    // Simulate a user utterance (normally handled by Keerthana's STT)
    const userUtterance = 'Hi, I want to book an appointment with Dr. Priya tomorrow morning.';
    session.responseGen.addUserMessage(userUtterance);
    
    console.log(`[Demo] Simulating user utterance: "${userUtterance}"...`);
    try {
      for await (const chunk of session.responseGen.generateResponse()) {
        process.stdout.write(chunk);
        session.tts.streamText(chunk, 'en-IN');
      }
      console.log('\n[Demo] ✅ Demo complete.\n');
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`\n[Demo] LLM unavailable in dev (${msg})`);
      console.log('[Demo] ✅ All components booted and wired correctly. Add your API keys to .env to run with a real LLM.\n');
    }
  }
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
