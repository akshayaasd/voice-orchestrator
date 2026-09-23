import {
  UnifiedAppointmentAdapter,
  AvailableSlot,
  HoldResult,
  BookingResult,
  ClientProfile,
} from './UnifiedAppointmentAdapter';

/**
 * Mock implementation of UnifiedAppointmentAdapter for local development
 * and integration testing. Returns realistic-looking data without hitting
 * any external API.
 */
export class MockAppointmentAdapter implements UnifiedAppointmentAdapter {
  private holds: Map<string, { slotId: string; tenantId: string; expiresAt: Date }> = new Map();
  private bookings: Map<string, BookingResult> = new Map(); // phone → booking

  async searchSlots(params: {
    tenantId: string;
    startDate: string;
    endDate: string;
    serviceType?: string;
    staffId?: string;
  }): Promise<AvailableSlot[]> {
    console.log(`[MockAdapter] searchSlots for tenant=${params.tenantId}`);
    // Return a set of mock slots on the requested start date
    const base = new Date(params.startDate);
    return [
      {
        slotId:       `slot-${params.tenantId}-1000`,
        staffId:      'dr-sharma-01',
        staffName:    'Dr. Priya Sharma',
        serviceType:  params.serviceType ?? 'General Consultation',
        startTimeISO: new Date(base.setHours(10, 0, 0, 0)).toISOString(),
        endTimeISO:   new Date(base.setHours(10, 30, 0, 0)).toISOString(),
        locationName: 'Clinic Room 2',
        durationMins: 30,
      },
      {
        slotId:       `slot-${params.tenantId}-1130`,
        staffId:      'dr-sharma-01',
        staffName:    'Dr. Priya Sharma',
        serviceType:  params.serviceType ?? 'General Consultation',
        startTimeISO: new Date(base.setHours(11, 30, 0, 0)).toISOString(),
        endTimeISO:   new Date(base.setHours(12, 0, 0, 0)).toISOString(),
        locationName: 'Clinic Room 2',
        durationMins: 30,
      },
    ];
  }

  async holdSlot(params: {
    tenantId: string;
    slotId: string;
    holdDurationSeconds?: number;
  }): Promise<HoldResult> {
    const ttl = params.holdDurationSeconds ?? 180;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const holdToken = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.holds.set(holdToken, { slotId: params.slotId, tenantId: params.tenantId, expiresAt });
    console.log(`[MockAdapter] holdSlot: slotId=${params.slotId} token=${holdToken} expires=${expiresAt.toISOString()}`);

    return { holdToken, slotId: params.slotId, expiresAt: expiresAt.toISOString() };
  }

  async confirmBooking(params: {
    tenantId: string;
    holdToken: string;
    clientDetails: ClientProfile;
    appointmentTypeId?: string;
    notes?: string;
  }): Promise<BookingResult> {
    const hold = this.holds.get(params.holdToken);
    if (!hold) throw new Error(`[MockAdapter] Invalid or expired holdToken: ${params.holdToken}`);
    if (new Date() > hold.expiresAt) throw new Error(`[MockAdapter] Hold expired for token: ${params.holdToken}`);

    this.holds.delete(params.holdToken); // Release the lock

    const result: BookingResult = {
      externalAppointmentId: `appt-${Date.now()}`,
      confirmationCode:      `CONF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      confirmedSlot: {
        slotId:       hold.slotId,
        staffId:      'dr-sharma-01',
        staffName:    'Dr. Priya Sharma',
        serviceType:  params.appointmentTypeId ?? 'General Consultation',
        startTimeISO: new Date().toISOString(),
        endTimeISO:   new Date().toISOString(),
        locationName: 'Clinic Room 2',
      },
    };

    this.bookings.set(params.clientDetails.phone, result);
    console.log(`[MockAdapter] confirmBooking: code=${result.confirmationCode} for ${params.clientDetails.phone}`);
    return result;
  }

  async releaseHold(params: { tenantId: string; holdToken: string }): Promise<void> {
    this.holds.delete(params.holdToken);
    console.log(`[MockAdapter] releaseHold: token=${params.holdToken}`);
  }

  async getBookingByPhone(params: { tenantId: string; phone: string }): Promise<BookingResult | null> {
    return this.bookings.get(params.phone) ?? null;
  }

  async cancelBooking(params: {
    tenantId: string;
    externalAppointmentId: string;
    reason?: string;
  }): Promise<void> {
    console.log(`[MockAdapter] cancelBooking: apptId=${params.externalAppointmentId} reason=${params.reason ?? 'none'}`);
    // Find and remove booking
    for (const [phone, booking] of this.bookings.entries()) {
      if (booking.externalAppointmentId === params.externalAppointmentId) {
        this.bookings.delete(phone);
        break;
      }
    }
  }
}
