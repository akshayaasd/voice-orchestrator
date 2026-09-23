/**
 * Telephony Provider Interface
 * Abstracts over LiveKit SIP Gateway, Exotel, Twilio, and Telnyx.
 * Keerthana's ingress layer implements this to feed raw audio
 * into the STT → Orchestrator pipeline.
 */

export interface InboundCallMetadata {
  callSid:      string;   // Unique call identifier from telephony provider
  callerPhone:  string;   // E.164 format (e.g., "+919876543210")
  calledNumber: string;   // The number the caller dialed (tenant's virtual number)
  tenantId:     string;   // Resolved from calledNumber → tenant lookup
  codec:        'g711' | 'opus' | 'pcm'; // Audio codec in use
  sampleRate:   8000 | 16000;
}

export interface TelephonyProvider {
  /**
   * Start listening for inbound calls.
   * Fires the onCallArrived callback each time a new call connects.
   */
  startListening(): Promise<void>;

  /**
   * Register a callback that fires when a new inbound call arrives.
   */
  onCallArrived(callback: (call: InboundCallMetadata, audioStream: NodeJS.ReadableStream) => void): void;

  /**
   * Terminate an active call gracefully.
   */
  hangUp(callSid: string): Promise<void>;

  /**
   * Send a SIP REFER to transfer the call to a live agent.
   */
  transferCall(callSid: string, destinationSipUri: string): Promise<void>;
}
