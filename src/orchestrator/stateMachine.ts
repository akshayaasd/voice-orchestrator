import { EventEmitter } from 'events';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CALL STATE MACHINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Manages the full lifecycle of a single inbound/outbound voice call.
 *
 * States (in sequence):
 *   IDLE → CALL_INIT → CONTEXT_AND_IDENTITY → INTENT_RECOGNITION
 *        → ACTION_NEGOTIATION → CONFIRMATION_EGRESS → WRAP_UP → TERMINATED
 *                                                   ↓
 *                                              ESCALATION → TERMINATED
 *
 * This class is 100% vertical-agnostic — it doesn't care if it's healthcare,
 * salon, or legal. Vertical logic lives in system prompts and adapters.
 */

export enum CallState {
  IDLE                 = 'IDLE',
  CALL_INIT            = 'CALL_INIT',
  CONTEXT_AND_IDENTITY = 'CONTEXT_AND_IDENTITY',
  INTENT_RECOGNITION   = 'INTENT_RECOGNITION',
  ACTION_NEGOTIATION   = 'ACTION_NEGOTIATION',
  CONFIRMATION_EGRESS  = 'CONFIRMATION_EGRESS',
  ESCALATION           = 'ESCALATION',
  WRAP_UP              = 'WRAP_UP',
  TERMINATED           = 'TERMINATED',
}

export type DetectedIntent =
  | 'BOOKING'
  | 'RESCHEDULE'
  | 'CANCEL'
  | 'FAQ'
  | 'EMERGENCY'
  | null;

export interface TranscriptEntry {
  role:      'user' | 'assistant';
  text:      string;
  timestamp: Date;
}

export interface ActiveHold {
  holdToken:  string;
  slotId:     string;
  expiresAt:  Date;
}

export interface CallerProfile {
  name?:        string;
  phone:        string;
  dateOfBirth?: string; // Required for healthcare EHR verification
}

export interface CallSession {
  callSid:               string;
  tenantId:              string;
  callerPhone:           string;
  state:                 CallState;
  transcriptBuffer:      TranscriptEntry[];
  activeHolds:           ActiveHold[];
  identifiedCaller?:     CallerProfile;
  detectedIntent:        DetectedIntent;
  confirmedBookingId?:   string;
  confirmationCode?:     string;
  startedAt:             Date;
  lastStateChangeAt:     Date;
  escalationDestination?: string; // SIP URI for REFER transfer
}

// Valid state transitions
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.IDLE]:                 [CallState.CALL_INIT],
  [CallState.CALL_INIT]:            [CallState.CONTEXT_AND_IDENTITY],
  [CallState.CONTEXT_AND_IDENTITY]: [CallState.INTENT_RECOGNITION],
  [CallState.INTENT_RECOGNITION]:   [CallState.ACTION_NEGOTIATION, CallState.ESCALATION, CallState.WRAP_UP],
  [CallState.ACTION_NEGOTIATION]:   [CallState.CONFIRMATION_EGRESS, CallState.ACTION_NEGOTIATION, CallState.WRAP_UP],
  [CallState.CONFIRMATION_EGRESS]:  [CallState.WRAP_UP, CallState.ACTION_NEGOTIATION],
  [CallState.ESCALATION]:           [CallState.TERMINATED],
  [CallState.WRAP_UP]:              [CallState.TERMINATED],
  [CallState.TERMINATED]:           [],
};

export class CallStateMachine extends EventEmitter {
  public session: CallSession;

  constructor(callSid: string, tenantId: string, callerPhone: string) {
    super();
    this.session = {
      callSid,
      tenantId,
      callerPhone,
      state:               CallState.IDLE,
      transcriptBuffer:    [],
      activeHolds:         [],
      detectedIntent:      null,
      startedAt:           new Date(),
      lastStateChangeAt:   new Date(),
    };
    console.log(`[FSM] New call session: callSid=${callSid} tenant=${tenantId} caller=${callerPhone}`);
  }

  /**
   * Transition to the next state. Throws if the transition is invalid.
   */
  public transition(to: CallState): void {
    const from = this.session.state;
    const allowed = VALID_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw new Error(
        `[FSM] Invalid transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`,
      );
    }

    console.log(`[FSM] State transition: ${from} → ${to}`);
    this.session.state = to;
    this.session.lastStateChangeAt = new Date();
    this.emit('stateChange', { from, to, session: this.session });
  }

  /** Append a user or assistant utterance to the transcript buffer. */
  public appendTranscript(role: 'user' | 'assistant', text: string): void {
    this.session.transcriptBuffer.push({ role, text, timestamp: new Date() });
    // Cap buffer at 50 entries to prevent memory bloat
    if (this.session.transcriptBuffer.length > 50) {
      this.session.transcriptBuffer = this.session.transcriptBuffer.slice(-50);
    }
  }

  /** Record a caller identification result. */
  public identifyCaller(profile: CallerProfile): void {
    this.session.identifiedCaller = profile;
    console.log(`[FSM] Caller identified: ${profile.name ?? profile.phone}`);
  }

  /** Set the detected intent. */
  public setIntent(intent: DetectedIntent): void {
    this.session.detectedIntent = intent;
    console.log(`[FSM] Intent detected: ${intent}`);
    this.emit('intentDetected', intent);
  }

  /** Register a new Redis soft-lock hold on a slot. */
  public addHold(hold: ActiveHold): void {
    this.session.activeHolds.push(hold);
  }

  /** Remove a hold when it's confirmed or released. */
  public removeHold(holdToken: string): void {
    this.session.activeHolds = this.session.activeHolds.filter(
      (h) => h.holdToken !== holdToken,
    );
  }

  /** Record the final confirmed booking. */
  public setConfirmedBooking(bookingId: string, confirmationCode: string): void {
    this.session.confirmedBookingId = bookingId;
    this.session.confirmationCode   = confirmationCode;
    console.log(`[FSM] Booking confirmed: ${bookingId} (code: ${confirmationCode})`);
  }

  /** Get elapsed call duration in seconds. */
  public getCallDurationSeconds(): number {
    return (Date.now() - this.session.startedAt.getTime()) / 1000;
  }

  get currentState(): CallState {
    return this.session.state;
  }
}
