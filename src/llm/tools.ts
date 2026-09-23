export const TOOL_SEARCH_SLOTS = {
  type: 'function',
  function: {
    name:        'search_slots',
    description: 'Search for available appointment slots within a date range. Call this first before offering options to the caller.',
    parameters: {
      type: 'object',
      properties: {
        start_date:   { type: 'string', format: 'date', description: 'Start date in YYYY-MM-DD format' },
        end_date:     { type: 'string', format: 'date', description: 'End date in YYYY-MM-DD format' },
        service_type: { type: 'string', description: 'The type of service or specialty requested (optional)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
} as const;

export const TOOL_HOLD_SLOT = {
  type: 'function',
  function: {
    name:        'hold_slot',
    description: 'Temporarily hold a calendar slot for 3 minutes while confirming with the caller. MUST be called before book_appointment.',
    parameters: {
      type: 'object',
      properties: {
        slot_id: { type: 'string', description: 'The slotId returned from search_slots' },
      },
      required: ['slot_id'],
    },
  },
} as const;

export const TOOL_BOOK_APPOINTMENT = {
  type: 'function',
  function: {
    name:        'book_appointment',
    description: 'Finalize and permanently commit an appointment ONLY after the caller has explicitly confirmed the date, time, and details. Requires a hold_token from a prior hold_slot call.',
    parameters: {
      type: 'object',
      properties: {
        hold_token:          { type: 'string', description: 'The holdToken from the prior hold_slot call' },
        customer_name:       { type: 'string', description: 'Full name of the caller' },
        customer_phone:      { type: 'string', description: 'Phone number of the caller in E.164 format' },
        service_or_specialty:{ type: 'string', description: 'The confirmed service or medical specialty' },
        notes:               { type: 'string', description: 'Any additional notes from the caller (optional)' },
      },
      required: ['hold_token', 'customer_name', 'customer_phone'],
    },
  },
} as const;

export const TOOL_CANCEL_BOOKING = {
  type: 'function',
  function: {
    name:        'cancel_booking',
    description: 'Cancel an existing appointment. Only call this after confirming the appointment details with the caller.',
    parameters: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'The externalAppointmentId to cancel' },
        reason:         { type: 'string', description: 'Reason for cancellation (optional)' },
      },
      required: ['appointment_id'],
    },
  },
} as const;

/** All tools to pass to LLM providers that support function calling. */
export const ALL_TOOLS = [
  TOOL_SEARCH_SLOTS,
  TOOL_HOLD_SLOT,
  TOOL_BOOK_APPOINTMENT,
  TOOL_CANCEL_BOOKING,
] as const;
