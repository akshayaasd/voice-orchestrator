/**
 * SMS Provider Interface
 * Used to dispatch confirmation, cancellation, and reminder SMS messages
 * to callers after booking actions complete.
 */

export interface SMSMessage {
  to:      string; // E.164 phone number (e.g., "+919876543210")
  from:    string; // Sender's virtual number
  body:    string; // Message text (keep under 160 chars for single SMS)
}

export interface SMSProvider {
  send(message: SMSMessage): Promise<void>;
}

// ─── Pre-built SMS message templates ──────────────────────────────────────────

export function buildBookingConfirmationSMS(params: {
  patientName:    string;
  serviceName:    string;
  staffName:      string;
  dateTime:       string; // Human-readable (e.g., "Wed 25 Sep, 10:00 AM")
  locationName:   string;
  confirmationCode: string;
}): string {
  return (
    `✅ Confirmed: ${params.patientName}, your ${params.serviceName} with ${params.staffName} ` +
    `is booked for ${params.dateTime} at ${params.locationName}. ` +
    `Code: ${params.confirmationCode}`
  );
}

export function buildCancellationSMS(params: {
  patientName:  string;
  serviceName:  string;
  dateTime:     string;
}): string {
  return (
    `❌ Cancelled: ${params.patientName}, your ${params.serviceName} on ${params.dateTime} ` +
    `has been cancelled. Call us to rebook.`
  );
}

export function buildRescheduleSMS(params: {
  patientName:   string;
  newDateTime:   string;
  confirmationCode: string;
}): string {
  return (
    `🔄 Rescheduled: ${params.patientName}, your appointment has been moved to ` +
    `${params.newDateTime}. New code: ${params.confirmationCode}`
  );
}
