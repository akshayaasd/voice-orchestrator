/**
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIFIED APPOINTMENT ADAPTER  —  Core Integration Interface
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * This interface decouples the AI orchestrator from any specific client booking
 * system (Cliniko, Practo, Jane App, Google Calendar, custom REST APIs, etc.)
 *
 * Every client integration MUST implement this interface. The orchestrator
 * only ever talks to this abstraction — it has zero knowledge of the underlying
 * third-party API.
 *
 * 2-Phase Booking Flow:
 *   1. holdSlot()    → Redis soft-lock (prevents double booking during negotiation)
 *   2. confirmBooking() → Postgres hard commit + release Redis lock
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface AvailableSlot {
  slotId:       string;
  staffId:      string;
  staffName:    string;
  serviceType:  string;
  startTimeISO: string; // ISO 8601
  endTimeISO:   string; // ISO 8601
  locationName?: string;
  durationMins?: number;
}

export interface ClientProfile {
  name:        string;
  phone:       string;
  email?:      string;
  dateOfBirth?: string; // Required for healthcare EHR identity verification
  notes?:      string;
}

export interface HoldResult {
  holdToken:  string; // Opaque token used for Phase 2 confirm
  slotId:     string;
  expiresAt:  string; // ISO 8601 — when the Redis soft lock expires
}

export interface BookingResult {
  externalAppointmentId: string; // ID in the client's own booking system
  confirmationCode:      string; // Human-readable code to read back to caller
  confirmedSlot:         AvailableSlot;
}

export interface UnifiedAppointmentAdapter {
  /**
   * Search available slots for a given tenant within a date range.
   * Used by the LLM during the ACTION_NEGOTIATION state.
   */
  searchSlots(params: {
    tenantId:     string;
    startDate:    string; // ISO 8601 date (e.g., "2026-09-25")
    endDate:      string;
    serviceType?: string;
    staffId?:     string;
  }): Promise<AvailableSlot[]>;

  /**
   * Phase 1 — Place a Redis-backed temporary soft lock on a slot (default: 3 min TTL).
   * This prevents another concurrent caller from grabbing the same slot.
   * Returns a holdToken used in Phase 2.
   */
  holdSlot(params: {
    tenantId:             string;
    slotId:               string;
    holdDurationSeconds?: number; // Default: 180
  }): Promise<HoldResult>;

  /**
   * Phase 2 — Permanently commit the booking after caller verbal confirmation.
   * Writes to the client's database and releases the Redis soft lock.
   */
  confirmBooking(params: {
    tenantId:          string;
    holdToken:         string;
    clientDetails:     ClientProfile;
    appointmentTypeId?: string;
    notes?:            string;
  }): Promise<BookingResult>;

  /**
   * Release a soft lock WITHOUT committing (caller hung up, timed out, or changed mind).
   */
  releaseHold(params: {
    tenantId:  string;
    holdToken: string;
  }): Promise<void>;

  /**
   * Look up an existing booking by caller phone.
   * Used in RESCHEDULE and CANCEL flows.
   */
  getBookingByPhone(params: {
    tenantId: string;
    phone:    string;
  }): Promise<BookingResult | null>;

  /**
   * Cancel an existing booking.
   */
  cancelBooking(params: {
    tenantId:               string;
    externalAppointmentId:  string;
    reason?:                string;
  }): Promise<void>;
}
