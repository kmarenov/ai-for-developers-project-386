import "@typespec/http";
import "@typespec/openapi3";

using Http;

/** Simplified Cal.com-like call booking service. */
@service(#{ title: "Call Calendar API" })
@server("http://localhost:8081", "Local development")
namespace CallCalendar;

model HealthResponse {
  status: "ok";
}

model MeetingType {
  id: string;
  title: string;
  description: string;
  duration_minutes: int32;
}

model CreateMeetingTypeRequest {
  title: string;
  description: string;
  duration_minutes: int32;
}

model TimeSlot {
  start_time: utcDateTime;
  end_time: utcDateTime;
  is_available: boolean;
}

model Booking {
  id: string;
  meeting_type_id: string;
  start_time: utcDateTime;
  end_time: utcDateTime;
  guest_name: string;
  guest_email: string;
}

model CreateBookingRequest {
  meeting_type_id: string;
  start_time: utcDateTime;
  guest_name: string;
  guest_email: string;
}

model ErrorResponse {
  message: string;
}

@route("/health")
@get
op getHealth(): HealthResponse;

@route("/meeting-types")
@get
op listMeetingTypes(): MeetingType[];

@route("/meeting-types")
@post
op createMeetingType(@body body: CreateMeetingTypeRequest): MeetingType;

@route("/available-slots")
@get
op listAvailableSlots(
  @query typeId: string,
  @query date: string,
): TimeSlot[];

@route("/bookings")
@get
op listBookings(): Booking[];

@route("/bookings")
@post
op createBooking(@body body: CreateBookingRequest): Booking;
