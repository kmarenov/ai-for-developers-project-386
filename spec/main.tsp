import "@typespec/http";
import "@typespec/openapi3";

using Http;

/** Simplified Cal.com-like call booking service. */
@service(#{ title: "Call Calendar API" })
@server("http://localhost:8081", "Local development")
namespace CallCalendar;

/** Machine-readable error codes returned by the API. */
union ErrorCode {
  invalid_request: "invalid_request",
  invalid_slot: "invalid_slot",
  meeting_type_not_found: "meeting_type_not_found",
  slot_taken: "slot_taken",
  not_found: "not_found",
  method_not_allowed: "method_not_allowed",
  internal_error: "internal_error",
}

model HealthResponse {
  status: "ok";
}

model ConfigResponse {
  /** IANA timezone of the calendar owner. */
  timezone: string;

  /** Working day start in HH:MM. */
  working_hours_start: string;

  /** Working day end in HH:MM. */
  working_hours_end: string;

  @minValue(1)
  slot_step_minutes: int32;

  @minValue(1)
  booking_window_days: int32;

  /** Current date in the owner timezone as YYYY-MM-DD. */
  today: string;
}

model MeetingType {
  @format("uuid")
  id: string;

  @minLength(1)
  @maxLength(100)
  title: string;

  @maxLength(500)
  description: string;

  @minValue(5)
  @maxValue(480)
  duration_minutes: int32;
}

model CreateMeetingTypeRequest {
  @minLength(1)
  @maxLength(100)
  title: string;

  @maxLength(500)
  description: string;

  @minValue(5)
  @maxValue(480)
  duration_minutes: int32;
}

model TimeSlot {
  start_time: utcDateTime;
  end_time: utcDateTime;
}

model Booking {
  @format("uuid")
  id: string;

  @format("uuid")
  meeting_type_id: string;

  start_time: utcDateTime;
  end_time: utcDateTime;

  @minLength(1)
  @maxLength(100)
  guest_name: string;

  @format("email")
  @maxLength(254)
  guest_email: string;
}

model CreateBookingRequest {
  @format("uuid")
  meeting_type_id: string;

  start_time: utcDateTime;

  @minLength(1)
  @maxLength(100)
  guest_name: string;

  @format("email")
  @maxLength(254)
  guest_email: string;
}

@error
model ErrorResponse {
  code: ErrorCode;
  message: string;
}

@route("/health")
@get
op getHealth(): HealthResponse | (Response<500> & ErrorResponse);

@route("/config")
@get
op getConfig(): ConfigResponse | (Response<500> & ErrorResponse);

@route("/meeting-types")
@get
op listMeetingTypes(): MeetingType[] | (Response<500> & ErrorResponse);

@route("/meeting-types")
@post
op createMeetingType(
  @body body: CreateMeetingTypeRequest,
): (CreatedResponse & MeetingType) | (BadRequestResponse & ErrorResponse) | (Response<500> & ErrorResponse);

@route("/available-slots")
@get
op listAvailableSlots(
  @query @format("uuid") meeting_type_id: string,
): TimeSlot[] | (BadRequestResponse & ErrorResponse) | (NotFoundResponse & ErrorResponse) | (Response<500> & ErrorResponse);

@route("/bookings")
@get
op listBookings(): Booking[] | (Response<500> & ErrorResponse);

@route("/bookings")
@post
op createBooking(
  @body body: CreateBookingRequest,
):
  | (CreatedResponse & Booking)
  | (BadRequestResponse & ErrorResponse)
  | (NotFoundResponse & ErrorResponse)
  | (ConflictResponse & ErrorResponse)
  | (Response<500> & ErrorResponse);
