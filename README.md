# voice-orchestrator

The core engine for a multi-tenant Voice AI platform built for inbound telephony. Handles the full pipeline from a caller's voice to a confirmed appointment booking — designed for healthcare clinics, salons, and legal firms operating in India and globally.

---

## What it does

When someone calls a business number:

1. The PSTN call arrives via a SIP trunk → LiveKit SIP Gateway
2. The caller's audio is streamed to Deepgram (English) or Sarvam Saaras (Hindi/Tamil/etc.) for transcription
3. Silero VAD watches for barge-in — if the caller interrupts, TTS stops immediately
4. The transcript goes to an LLM (Groq / Gemini / Ollama) with a vertical-specific system prompt
5. The LLM either responds or calls a tool (search slots, hold a slot, confirm booking, cancel)
6. Tool calls go through the `UnifiedAppointmentAdapter` — a single interface that works with any booking backend
7. The AI's response is streamed word-by-word to Sarvam Bulbul for voice synthesis
8. Audio bytes are piped back to the caller via LiveKit WebSockets
9. On booking confirmation, an SMS goes out to the caller via Exotel

The whole round-trip targets **< 600ms** end-to-end (P95 < 800ms).

---

## Verticals supported

| Vertical | AI Persona | Key behaviours |
|:---|:---|:---|
| **Healthcare** | Medical receptionist | DOB verification, emergency 911 redirect, no medical advice |
| **Salon** | Beauty booking assistant | Service/stylist matching, cancellation policy |
| **Legal** | Intake assistant | Conflict-of-interest screening, urgent matter flagging, no legal advice |

---

## Tech stack

| Layer | Technology |
|:---|:---|
| Telephony ingest | LiveKit SIP Gateway + Exotel (India) / Twilio (Global) |
| Speech-to-Text | Deepgram Nova-2 (English) · Sarvam Saaras (Indic) |
| Voice Activity Detection | Silero VAD (ONNX, 40ms window) |
| LLM | Groq Llama 3.3 70B · Gemini 1.5 Flash · Ollama (local dev) |
| Text-to-Speech | Sarvam Bulbul |
| Audio egress | LiveKit WebSockets + jitter buffer |
| Slot locking | Redis `SET NX` 2-phase lock |
| SMS | Exotel REST API |
| Language | TypeScript (Node.js) |

---

## Project structure

```
src/
├── index.ts                          Entry point — boots and wires all components
├── config.ts                         Loads .env into a typed config object
│
├── orchestrator/
│   ├── stateMachine.ts               8-state call FSM (IDLE → TERMINATED)
│   └── responseGenerator.ts          Streams LLM tokens to TTS, executes tool calls
│
├── adapters/
│   ├── UnifiedAppointmentAdapter.ts  Booking interface every client integration must implement
│   └── MockAppointmentAdapter.ts     In-memory mock for local development
│
├── llm/
│   ├── llmProvider.ts                LLM interface
│   ├── geminiProvider.ts             Gemini 1.5 Flash (streaming + function calling)
│   ├── groqProvider.ts               Groq Llama 3.3 70B (fastest TTFT)
│   ├── ollamaProvider.ts             Local Ollama (dev fallback)
│   ├── tools.ts                      search_slots · hold_slot · book_appointment · cancel_booking
│   └── prompts/
│       ├── healthcarePrompt.ts
│       ├── salonPrompt.ts
│       └── legalPrompt.ts
│
├── stt/
│   ├── sttProvider.ts                STT interface
│   ├── deepgramProvider.ts           Deepgram Nova-2 via WebSocket
│   └── sarvamSTTProvider.ts          Sarvam Saaras (Hindi, Tamil, Telugu, etc.)
│
├── tts/
│   ├── ttsProvider.ts                TTS interface
│   └── sarvamProvider.ts             Sarvam Bulbul WebSocket streaming
│
├── vad/
│   └── vadHandler.ts                 Silero probability scores → barge-in events
│
├── redis/
│   └── slotLockManager.ts            2-phase atomic slot lock + call session state
│
├── telephony/
│   ├── telephonyProvider.ts          Telephony interface
│   └── livekitSIPGateway.ts          LiveKit SIP Gateway + SIP REFER (human escalation)
│
├── egress/
│   └── livekitEgress.ts              PCM audio → LiveKit WebSocket, barge-in flush
│
└── sms/
    ├── smsProvider.ts                SMS interface + message templates
    └── exotelSMSProvider.ts          Exotel India REST SMS
```

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your keys. At minimum, pick one LLM provider:

```env
# Pick one — Groq is the fastest
GROQ_API_KEY=your_key_here

# STT — pick based on language
DEEPGRAM_API_KEY=your_key_here   # English
SARVAM_API_KEY=your_key_here     # Indic languages (also covers TTS)
```

The app auto-selects the LLM in priority order: **Groq → Gemini → Ollama**. If none are configured, it falls back to Ollama (requires Ollama running locally).

### 3. Run in development

```bash
npm run dev
```

Boots the full pipeline and runs a simulated call with the mock booking adapter — no real phone call or API key needed to see it working. Each component initialises and you can watch the FSM step through its states in the logs.

### 4. Build for production

```bash
npm run build   # compiles TypeScript → dist/
npm start       # runs compiled output
```

---

## How the double-booking lock works

Two callers can never grab the same slot at the same time. Redis handles it atomically:

```
Caller asks for 10:00 AM slot
        │
        ▼
Phase 1 — Redis soft lock (120s TTL)
  SET slot:{tenantId}:{slotId}  "LOCKED"  EX 120  NX
  → Key already exists: slot taken — offer the next available time
  → Set succeeds: proceed with caller confirmation
        │
        ▼
Caller confirms on the phone
        │
        ▼
Phase 2 — Hard commit
  → confirmBooking() writes to the client's booking system
  → Redis key deleted on success
  → SMS confirmation dispatched to caller
```

---

## Adding a new booking backend

Implement the `UnifiedAppointmentAdapter` interface:

```typescript
import type { UnifiedAppointmentAdapter } from './UnifiedAppointmentAdapter';

export class ClinikoAdapter implements UnifiedAppointmentAdapter {
  async searchSlots(params)    { /* call Cliniko API */ }
  async holdSlot(params)       { /* acquire Redis lock */ }
  async confirmBooking(params) { /* POST to Cliniko + release lock */ }
  async releaseHold(params)    { /* delete Redis key */ }
  async getBookingByPhone(params) { /* lookup for reschedule/cancel */ }
  async cancelBooking(params)  { /* cancel in Cliniko */ }
}
```

Pass the adapter into `bootstrapCallSession()` in `index.ts`. Everything else in the pipeline stays the same.

---

## Adding a new vertical

1. Create a system prompt in `src/llm/prompts/yourVerticalPrompt.ts`
2. Add the vertical name to the `Vertical` type in `index.ts`
3. Add a case to the `getSystemPrompt()` switch

The rest of the pipeline is vertical-agnostic.

---

## Call state machine

```
IDLE
  └─▶ CALL_INIT                (SIP call connected)
        └─▶ CONTEXT_AND_IDENTITY   (greeting + caller verification)
              └─▶ INTENT_RECOGNITION    (booking / reschedule / FAQ / emergency)
                    ├─▶ ACTION_NEGOTIATION     (slot search, hold, negotiate)
                    │     └─▶ CONFIRMATION_EGRESS   (verbal confirm + commit + SMS)
                    │           └─▶ WRAP_UP → TERMINATED
                    └─▶ ESCALATION    (SIP REFER to live human agent)
                          └─▶ TERMINATED
```

---

## Latency budget

| Step | Target |
|:---|:---|
| PSTN → media ingest | 30–50ms |
| Silero VAD | 40–60ms |
| STT first transcript | 100–140ms |
| Redis lock check | 20–40ms |
| LLM time-to-first-token | 120–180ms |
| TTS first audio chunk | 90–130ms |
| Egress buffer sync | 30–50ms |
| **Total end-to-end** | **430–650ms** |

---

## Cost reference

| Stack | Cost per minute |
|:---|:---|
| Tier 2 — India Hybrid (Exotel + Sarvam + Groq) | ₹2.30 / min |
| Tier 3 — Ultra Budget (self-hosted Whisper + Kokoro TTS) | ₹0.83 / min |
| Managed platforms (Vapi / Retell / Bland) | ₹8–14 / min |
