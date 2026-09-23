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

// ── STT ───────────────────────────────────────────────────────────────────────
import { DeepgramSTTProvider } from './stt/deepgramProvider';
import { SarvamSTTProvider }   from './stt/sarvamSTTProvider';

// ── TTS ───────────────────────────────────────────────────────────────────────
import { SarvamTTSProvider } from './tts/sarvamProvider';

// ── VAD ───────────────────────────────────────────────────────────────────────
import { VADHandler } from './vad/vadHandler';

// ── Egress ─────────────────────────────────────────────────────────────────────
import { LiveKitEgress } from './egress/livekitEgress';

// ── Telephony ──────────────────────────────────────────────────────────────────
import { LiveKitSIPGateway } from './telephony/livekitSIPGateway';

// ── Redis ─────────────────────────────────────────────────────────────────────
import { SlotLockManager } from './redis/slotLockManager';

// ── SMS ───────────────────────────────────────────────────────────────────────
import { ExotelSMSProvider } from './sms/exotelSMSProvider';
import { buildBookingConfirmationSMS } from './sms/smsProvider';

// ── Adapters ──────────────────────────────────────────────────────────────────
import { MockAppointmentAdapter } from './adapters/MockAppointmentAdapter';

// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER FACTORY
// Selects the right LLM based on config availability.
// Priority: Groq (fastest TTFT) → Gemini → Ollama (local dev fallback)
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
// Maps a vertical name to the correct system prompt.
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
// CALL SESSION BOOTSTRAPPER
// Wires all components together for a single inbound call.
// Called once per call. Each call gets its own isolated component instances.
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
  // Switch this to a real adapter (ClinikoPractice, Jane App, etc.) per tenant
  const adapter = new MockAppointmentAdapter();

  // ── 3. LLM + Response Generator ───────────────────────────────────────────
  const llm              = createLLMProvider();
  const systemPrompt     = getSystemPrompt(vertical);
  const responseGen      = new ResponseGenerator(llm, systemPrompt, adapter, tenantId);

  // ── 4. STT ────────────────────────────────────────────────────────────────
  const stt = config.stt.deepgramApiKey
    ? new DeepgramSTTProvider(config.stt.deepgramApiKey)
    : new SarvamSTTProvider(config.stt.sarvamApiKey);

  await stt.connect(language);

  // ── 5. TTS ────────────────────────────────────────────────────────────────
  const tts = new SarvamTTSProvider(config.tts.sarvamApiKey);
  await tts.connect();

  // ── 6. LiveKit Egress ─────────────────────────────────────────────────────
  const egress = new LiveKitEgress();
  // In production: egress.connect(livekitRoomUrl, roomToken)

  // ── 7. VAD Handler ────────────────────────────────────────────────────────
  const vad = new VADHandler(400);

  vad.on('barge_in', () => {
    console.warn('[Pipeline] ⚡ BARGE-IN → flushing TTS + egress buffer');
    tts.flush();
    egress.handleInterruption();
  });

  // ── 8. Wire TTS → Egress ──────────────────────────────────────────────────
  tts.onAudio((audioBytes) => {
    egress.sendAudio(audioBytes);
  });

  // ── 9. Wire STT → Orchestrator ────────────────────────────────────────────
  stt.onTranscript(async (result) => {
    if (!result.isFinal) return; // Only process completed utterances

    console.log(`[STT → Orch] Final transcript: "${result.text}"`);
    fsm.appendTranscript('user', result.text);
    responseGen.addUserMessage(result.text);

    // Stream LLM response directly into TTS
    for await (const textChunk of responseGen.generateResponse()) {
      tts.streamText(textChunk, language);
      fsm.appendTranscript('assistant', textChunk);
    }
    egress.markPlaybackComplete();
  });

  // ── 10. SMS Provider ──────────────────────────────────────────────────────
  const sms = new ExotelSMSProvider({
    sid:      config.sms.exotelSid,
    apiKey:   config.sms.exotelApiKey,
    apiToken: config.sms.exotelApiToken,
  });

  // Transition to identity verification
  fsm.transition(CallState.CONTEXT_AND_IDENTITY);

  return { fsm, responseGen, stt, tts, egress, vad, sms, adapter };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎙️  Voice Orchestrator — Starting up (${config.app.env})`);
  console.log(`📡  Port: ${config.app.port}`);
  console.log(`🔑  LLM: ${config.llm.groqApiKey ? 'Groq' : config.llm.geminiApiKey ? 'Gemini' : 'Ollama (local)'}`);
  console.log(`📱  STT: ${config.stt.deepgramApiKey ? 'Deepgram Nova-2' : 'Sarvam Saaras'}\n`);

  // ── SIP Gateway ───────────────────────────────────────────────────────────
  if (config.livekit.url && config.livekit.apiKey) {
    const gateway = new LiveKitSIPGateway(
      config.livekit.url,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );

    gateway.onCallArrived(async (callMeta, _audioStream) => {
      // Each inbound call gets its own isolated session
      await bootstrapCallSession({
        callSid:     callMeta.callSid,
        tenantId:    callMeta.tenantId,
        callerPhone: callMeta.callerPhone,
        vertical:    'healthcare', // TODO: resolve from tenant config
        language:    'en-IN',
      });
    });

    await gateway.startListening();
  } else {
    console.log('[Main] LiveKit not configured — skipping SIP gateway (run a demo below).');
  }

  // ── Local Dev Demo ────────────────────────────────────────────────────────
  if (config.app.isDev) {
    console.log('\n[Demo] Running local dev session (no real phone call)...\n');
    const session = await bootstrapCallSession({
      callSid:     `demo-${Date.now()}`,
      tenantId:    'tenant-demo',
      callerPhone: '+919876543210',
      vertical:    'healthcare',
      language:    'en-IN',
    });

    console.log('\n[Demo] Session bootstrapped successfully. FSM state:', session.fsm.currentState);
    console.log('[Demo] All components wired. Ready for audio input.\n');

    // Simulate a user utterance
    session.responseGen.addUserMessage('Hi, I want to book an appointment with Dr. Priya tomorrow morning.');
    console.log('[Demo] Simulating user utterance...');
    for await (const chunk of session.responseGen.generateResponse()) {
      process.stdout.write(chunk); // Print AI response to console in dev
    }
    console.log('\n[Demo] ✅ Demo complete.\n');
  }
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
