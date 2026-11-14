package httpapi_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/httpapi"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
)

// testNow is Saturday 03:00 in Moscow: the window starts on a weekend, so the
// first working day is Monday.
var testNow = time.Date(2026, time.November, 14, 0, 0, 0, 0, time.UTC)

// bookedIntervals is the booking-store seam for the HTTP layer: it returns the
// occupied half-open intervals of every meeting type. Bookings themselves
// arrive in a later ticket.
type bookingRecord struct {
	meetingTypeID string
	interval      timerules.Interval
}

type bookedIntervals []bookingRecord

func (b bookedIntervals) Busy() []timerules.Interval {
	intervals := make([]timerules.Interval, len(b))
	for index, booking := range b {
		intervals[index] = booking.interval
	}

	return intervals
}

type timeSlot struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
}

type configResponseBody struct {
	Timezone          string `json:"timezone"`
	WorkingHoursStart string `json:"working_hours_start"`
	WorkingHoursEnd   string `json:"working_hours_end"`
	SlotStepMinutes   int    `json:"slot_step_minutes"`
	BookingWindowDays int    `json:"booking_window_days"`
	Today             string `json:"today"`
}

func decodeTimeSlots(t *testing.T, payload []byte) []timeSlot {
	t.Helper()

	var slots []timeSlot
	if err := json.Unmarshal(payload, &slots); err != nil {
		t.Fatalf("decode time slots %q: %v", payload, err)
	}

	return slots
}

func createMeetingType(t *testing.T, server *httptest.Server, durationMinutes int) meetingtype.MeetingType {
	t.Helper()

	body := `{"title":"Встреча","description":"","duration_minutes":` + strconv.Itoa(durationMinutes) + `}`
	response, payload := doRequest(t, server, http.MethodPost, "/meeting-types", body)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create meeting type status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	return decodeMeetingType(t, payload)
}

func createMeetingTypeInStore(t *testing.T, store *meetingtype.Store, durationMinutes int) meetingtype.MeetingType {
	t.Helper()

	meetingType, err := store.Create(meetingtype.CreateInput{
		Title:           "Встреча",
		Description:     "",
		DurationMinutes: durationMinutes,
	})
	if err != nil {
		t.Fatalf("create meeting type in store: %v", err)
	}

	return meetingType
}

func TestGetConfigReturnsOwnerTimeRules(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodGet, "/config", "")

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	var body configResponseBody
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode config %q: %v", payload, err)
	}

	if body.Timezone != "Europe/Moscow" {
		t.Fatalf("timezone = %q, want Europe/Moscow", body.Timezone)
	}
	if body.WorkingHoursStart != "09:00" {
		t.Fatalf("working_hours_start = %q, want 09:00", body.WorkingHoursStart)
	}
	if body.WorkingHoursEnd != "18:00" {
		t.Fatalf("working_hours_end = %q, want 18:00", body.WorkingHoursEnd)
	}
	if body.SlotStepMinutes != 15 {
		t.Fatalf("slot_step_minutes = %d, want 15", body.SlotStepMinutes)
	}
	if body.BookingWindowDays != 14 {
		t.Fatalf("booking_window_days = %d, want 14", body.BookingWindowDays)
	}
	if body.Today != "2026-11-14" {
		t.Fatalf("today = %q, want the owner date 2026-11-14", body.Today)
	}
}

func TestAvailableSlotsCoverTheWindowSortedByStart(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())
	meetingType := createMeetingType(t, server, 30)

	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id="+meetingType.ID+"&date=2026-11-16&unknown=1", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	slots := decodeTimeSlots(t, payload)
	if len(slots) != 350 {
		t.Fatalf("slots = %d, want 10 working days x 35 starts", len(slots))
	}

	wantFirst := time.Date(2026, time.November, 16, 6, 0, 0, 0, time.UTC)
	if !slots[0].StartTime.Equal(wantFirst) {
		t.Fatalf("first start = %s, want %s", slots[0].StartTime, wantFirst)
	}

	wantLast := time.Date(2026, time.November, 27, 14, 30, 0, 0, time.UTC)
	if !slots[len(slots)-1].StartTime.Equal(wantLast) {
		t.Fatalf("last start = %s, want %s", slots[len(slots)-1].StartTime, wantLast)
	}

	for index, slot := range slots {
		if index > 0 && !slot.StartTime.After(slots[index-1].StartTime) {
			t.Fatalf("slot %d starts at %s, not after %s", index, slot.StartTime, slots[index-1].StartTime)
		}
		if duration := slot.EndTime.Sub(slot.StartTime); duration != 30*time.Minute {
			t.Fatalf("slot %s duration = %s, want 30m", slot.StartTime, duration)
		}
	}
}

func TestAvailableSlotsReturnEmptyArray(t *testing.T) {
	config := timerules.DefaultConfig()
	config.BookingWindowDays = 1
	rules := mustRules(t, config)

	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: meetingtype.NewStore(),
		TimeRules:    rules,
		Now:          func() time.Time { return testNow },
	})
	meetingType := createMeetingType(t, server, 30)

	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id="+meetingType.ID, "")

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}
	if got := string(payload); got != "[]\n" {
		t.Fatalf("body = %q, want []", got)
	}
}

func TestAvailableSlotsRejectInvalidMeetingTypeID(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	tests := []struct {
		name  string
		query string
	}{
		{name: "missing parameter", query: ""},
		{name: "empty parameter", query: "?meeting_type_id="},
		{name: "not a uuid", query: "?meeting_type_id=not-a-uuid"},
		{name: "truncated uuid", query: "?meeting_type_id=11111111-1111-4111-8111"},
		{name: "uuid with invalid characters", query: "?meeting_type_id=zzzzzzzz-1111-4111-8111-111111111111"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, payload := doRequest(t, server, http.MethodGet, "/available-slots"+test.query, "")

			assertErrorEnvelope(t, response, payload, http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestAvailableSlotsReturnNotFoundForUnknownMeetingType(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id=11111111-1111-4111-8111-111111111111", "")

	assertErrorEnvelope(t, response, payload, http.StatusNotFound, "meeting_type_not_found")
}

func TestAvailableSlotsValidateRequestBeforeLookingUpMeetingType(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	// The segment is both malformed and unknown, so the 400 check must win.
	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id=not-a-uuid", "")

	assertErrorEnvelope(t, response, payload, http.StatusBadRequest, "invalid_request")
}

func TestAvailableSlotsExcludeSlotsOccupiedByAnotherMeetingType(t *testing.T) {
	store := meetingtype.NewStore()
	rules := mustRules(t, timerules.DefaultConfig())

	requested := createMeetingTypeInStore(t, store, 30)
	other := createMeetingTypeInStore(t, store, 15)

	occupiedStart := time.Date(2026, time.November, 16, 6, 0, 0, 0, time.UTC) // Monday 09:00 MSK
	occupiedEnd := occupiedStart.Add(30 * time.Minute)

	// The occupied interval belongs to a booking of a different meeting type.
	bookings := bookedIntervals{{
		meetingTypeID: other.ID,
		interval:      timerules.Interval{Start: occupiedStart, End: occupiedEnd},
	}}

	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: store,
		TimeRules:    rules,
		Busy:         bookings,
		Now:          func() time.Time { return testNow },
	})

	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id="+requested.ID, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	slots := decodeTimeSlots(t, payload)
	for _, slot := range slots {
		if timerules.Overlaps(slot.StartTime, slot.EndTime, occupiedStart, occupiedEnd) {
			t.Fatalf("slot %s–%s overlaps a booking of another meeting type", slot.StartTime, slot.EndTime)
		}
	}

	if len(slots) == 0 {
		t.Fatal("slots are empty, want the rest of the window")
	}
	if !slots[0].StartTime.Equal(occupiedEnd) {
		t.Fatalf("first start = %s, want the adjacent %s", slots[0].StartTime, occupiedEnd)
	}
}

func TestAvailableSlotsMethodNotAllowed(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodPost, "/available-slots", "{}")

	assertErrorEnvelope(t, response, payload, http.StatusMethodNotAllowed, "method_not_allowed")
}

func TestAvailableSlotsStoreFailureReturnsInternalError(t *testing.T) {
	server := newTestServer(t, failingStore{})

	response, payload := doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id=11111111-1111-4111-8111-111111111111", "")

	assertErrorEnvelope(t, response, payload, http.StatusInternalServerError, "internal_error")
}

func TestConfigMethodNotAllowed(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodPost, "/config", "{}")

	assertErrorEnvelope(t, response, payload, http.StatusMethodNotAllowed, "method_not_allowed")
}

func mustRules(t *testing.T, config timerules.Config) timerules.Rules {
	t.Helper()

	rules, err := timerules.New(config)
	if err != nil {
		t.Fatalf("new time rules: %v", err)
	}

	return rules
}

func newTestServerWith(t *testing.T, deps httpapi.Deps) *httptest.Server {
	t.Helper()

	if deps.Logger == nil {
		deps.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if deps.AllowedOrigin == "" {
		deps.AllowedOrigin = "http://localhost:5173"
	}

	server := httptest.NewServer(httpapi.NewRouter(deps))
	t.Cleanup(server.Close)

	return server
}
