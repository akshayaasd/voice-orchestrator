# voice-orchestrator

The core engine behind a multi-tenant Voice AI platform for inbound telephony — built for Indian healthcare clinics, salons, and legal firms. It handles the full pipeline from a caller's voice to a confirmed appointment booking, end to end.

Built by **Akshayaa** (response & delivery) and **Keerthana** (input & understanding) as part of the Credang Voice AI project.

---

## What it does

When someone calls a business number:

1. The PSTN call arrives via Exotel → LiveKit SIP Gateway
2. The caller's audio is streamed to Deepgram (English) or Sarvam Saaras (Hindi/Tamil/etc.) for transcription
3. Silero VAD watches for barge-in — if the caller interrupts, TTS stops immediately
4. The transcript goes to an LLM (Groq / Gemini / Ollama) with a vertical-specific system prompt
5. The LLM either talks back or calls a tool (search slots, hold a slot, confirm booking, cancel)
6. Tool results go through the `UnifiedAppointmentAdapter` — a single interface that works with any booking backend
7. The AI's response is streamed word-by-word to Sarvam Bulbul for voice synthesis
8. Audio bytes are piped back to the caller via LiveKit WebSockets
9. On booking confirmation, an SMS goes out to the caller via Exotel

The whole round-trip targets **< 600ms** (P95 < 800ms).

---

## Verticals supported out of the box

| Vertical | AI Persona | Key behaviours |
|:---|:---|:---|
| **Healthcare** | Sarah — medical receptionist | DOB verification, emergency 911 redirect, no medical advice |
| **Salon** | Aria — beauty booking | Service/stylist matching, cancellation policy |
| **Legal** | Alex — intake assistant | Conflict-of-interest screening, urgent matter flagging, no legal advice |

---

## Tech stack

| Layer | Technology |
|:---|:---|
| Telephony ingest | LiveKit SIP Gateway + Exotel (India) / Twilio (Global) |
| STT | Deepgram Nova-2 (English) · Sarvam Saaras (Indic) |
| VAD | Silero VAD (ONNX, 40ms window) |
| LLM | Groq Llama 3.3 70B · Gemini 1.5 Flash · Ollama (local dev) |
| TTS | Sarvam Bulbul (Indic) |
| Audio egress | LiveKit WebSockets + jitter buffer |
| Slot locking | Redis `SET NX` 2-phase lock (prevents double-booking) |
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
│   └── responseGenerator.ts          Streams LLM tokens to TTS, runs tool calls
│
├── adapters/
│   ├── UnifiedAppointmentAdapter.ts  The booking interface every client must implement
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
│   └── vadHandler.ts                 Silero probability → speech_start / barge_in events
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
# Pick one — Groq is fastest
GROQ_API_KEY=your_key_here

# STT — pick one
DEEPGRAM_API_KEY=your_key_here   # English
SARVAM_API_KEY=your_key_here     # Indic languages (also used for TTS)
```

The app auto-selects the LLM in order: **Groq → Gemini → Ollama**. If none are set, it falls back to Ollama (requires Ollama running locally).

### 3. Run in development

```bash
npm run dev
```

This boots the full pipeline and runs a simulated call with a mock booking adapter — no real phone call needed. You'll see each component initialise and the FSM transitioning through states.

### 4. Build for production

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs the compiled output
```

---

## How booking works (the double-booking lock)

We use a 2-phase Redis lock to make sure two callers can never grab the same slot at the same time:

```
Caller asks for 10:00 AM slot
        │
        ▼
Phase 1 — Redis soft lock (120 second TTL)
  SET slot:tenant_1:slot-1000  "LOCKED"  EX 120  NX
  → If key already exists: slot taken — offer 10:30 AM instead
  → If set succeeds: proceed with caller confirmation
        │
        ▼
Caller confirms on the phone
        │
        ▼
Phase 2 — Hard commit to database (via UnifiedAppointmentAdapter)
  → confirmBooking() writes to client's booking system
  → Redis key deleted on success
  → SMS confirmation dispatched
```

---

## Adding a new booking backend (e.g. Cliniko, Practo, Google Calendar)

Implement the `UnifiedAppointmentAdapter` interface in [`src/adapters/UnifiedAppointmentAdapter.ts`](src/adapters/UnifiedAppointmentAdapter.ts):

```typescript
import { UnifiedAppointmentAdapter } from './UnifiedAppointmentAdapter';

export class ClinikoAdapter implements UnifiedAppointmentAdapter {
  async searchSlots(params) { /* call Cliniko API */ }
  async holdSlot(params)    { /* acquire Redis lock */ }
  async confirmBooking(params) { /* POST to Cliniko + release lock */ }
  // ...
}
```

Then pass it into `ResponseGenerator` in `index.ts`. The LLM and the rest of the pipeline don't need to know anything changed.

---

## Adding a new vertical (e.g. restaurant, gym)

1. Create a system prompt in `src/llm/prompts/yourVerticalPrompt.ts`
2. Add the vertical name to the `Vertical` type in `index.ts`
3. Add it to the `getSystemPrompt()` switch

That's it — the rest of the pipeline is vertical-agnostic.

---

## Call state machine

Every call moves through these states in order:

```
IDLE
  └─▶ CALL_INIT              (SIP call connected)
        └─▶ CONTEXT_AND_IDENTITY  (greeting + caller ID/DOB verification)
              └─▶ INTENT_RECOGNITION   (booking / reschedule / FAQ / emergency)
                    ├─▶ ACTION_NEGOTIATION    (slot search, hold, negotiate)
                    │     └─▶ CONFIRMATION_EGRESS  (verbal confirm + hard commit + SMS)
                    │           └─▶ WRAP_UP → TERMINATED
                    └─▶ ESCALATION   (SIP REFER to live human agent)
                          └─▶ TERMINATED
```

---

## Cost targets (from architecture spec)

| Stack | Cost per minute | Use case |
|:---|:---|:---|
| Tier 2 — India Hybrid | ₹2.30 / min | Production launch (Exotel + Sarvam + Groq) |
| Tier 3 — Ultra Budget | ₹0.83 / min | Scale phase (self-hosted Whisper + Kokoro TTS) |
| Vapi / Retell / Bland | ₹8–14 / min | What we're replacing |

At 10,000 calls/month, Tier 2 costs **₹57,500** vs **₹287,500** on Vapi — a saving of ₹2.76 lakh/month.

---

## Work split

| Owner | Modules |
|:---|:---|
| **Keerthana** | `telephony/`, `stt/`, `vad/`, `redis/` |
| **Akshayaa** | `orchestrator/`, `llm/`, `tts/`, `egress/`, `sms/` |
| **Both** | `adapters/`, `index.ts`, integration testing |
