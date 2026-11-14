package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/booking"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/httpapi"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
)

func bookingRequestBody(meetingTypeID string, start time.Time, name, email string) string {
	payload, err := json.Marshal(map[string]string{
		"meeting_type_id": meetingTypeID,
		"start_time":      start.Format(time.RFC3339),
		"guest_name":      name,
		"guest_email":     email,
	})
	if err != nil {
		panic(err)
	}

	return string(payload)
}

func decodeBooking(t *testing.T, payload []byte) booking.Booking {
	t.Helper()

	var created booking.Booking
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatalf("decode booking %q: %v", payload, err)
	}

	return created
}

func moscowTime(t *testing.T, month time.Month, day, hour, minute int) time.Time {
	t.Helper()

	location, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatalf("load Europe/Moscow: %v", err)
	}

	return time.Date(2026, month, day, hour, minute, 0, 0, location)
}

func TestCreateBookingReturnsCreatedBookingWithServerComputedEndTime(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 9, 0)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, start, "  Иван Петров  ", "  Guest@Example.COM  "),
	)

	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	created := decodeBooking(t, payload)
	if !uuidV4Pattern.MatchString(created.ID) {
		t.Fatalf("id = %q, want UUID v4", created.ID)
	}
	if created.MeetingTypeID != meetingType.ID {
		t.Fatalf("meeting_type_id = %q, want %q", created.MeetingTypeID, meetingType.ID)
	}
	if !created.StartTime.Equal(start) {
		t.Fatalf("start_time = %s, want %s", created.StartTime, start)
	}
	if !created.EndTime.Equal(start.Add(30 * time.Minute)) {
		t.Fatalf("end_time = %s, want %s", created.EndTime, start.Add(30*time.Minute))
	}
	if created.GuestName != "Иван Петров" {
		t.Fatalf("guest_name = %q, want trimmed name", created.GuestName)
	}
	if created.GuestEmail != "guest@example.com" {
		t.Fatalf("guest_email = %q, want trimmed lowercase email", created.GuestEmail)
	}
}

func TestCreateBookingInvalidRequest(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	start := "2026-11-16T09:00:00+03:00"
	tooLongName := ""
	for range 101 {
		tooLongName += "я"
	}
	tooLongEmail := ""
	for range 255 {
		tooLongEmail += "a"
	}
	tooLongEmail += "@example.com"

	tests := []struct {
		name string
		body string
	}{
		{name: "empty body", body: ""},
		{name: "invalid json", body: `{"meeting_type_id":`},
		{name: "trailing json", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван","guest_email":"guest@example.com"}{}`, meetingType.ID, start)},
		{name: "missing meeting type", body: fmt.Sprintf(`{"start_time":"%s","guest_name":"Иван","guest_email":"guest@example.com"}`, start)},
		{name: "meeting type is not a uuid", body: fmt.Sprintf(`{"meeting_type_id":"not-a-uuid","start_time":"%s","guest_name":"Иван","guest_email":"guest@example.com"}`, start)},
		{name: "meeting type is a number", body: `{"meeting_type_id":42,"start_time":"` + start + `","guest_name":"Иван","guest_email":"guest@example.com"}`},
		{name: "missing start time", body: fmt.Sprintf(`{"meeting_type_id":"%s","guest_name":"Иван","guest_email":"guest@example.com"}`, meetingType.ID)},
		{name: "naive start time without zone", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"2026-11-16T09:00:00","guest_name":"Иван","guest_email":"guest@example.com"}`, meetingType.ID)},
		{name: "start time is a unix integer", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":1763278800,"guest_name":"Иван","guest_email":"guest@example.com"}`, meetingType.ID)},
		{name: "missing guest name", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_email":"guest@example.com"}`, meetingType.ID, start)},
		{name: "blank guest name", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"   ","guest_email":"guest@example.com"}`, meetingType.ID, start)},
		{name: "guest name too long", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"%s","guest_email":"guest@example.com"}`, meetingType.ID, start, tooLongName)},
		{name: "missing guest email", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван"}`, meetingType.ID, start)},
		{name: "blank guest email", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван","guest_email":"   "}`, meetingType.ID, start)},
		{name: "malformed guest email", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван","guest_email":"not-an-email"}`, meetingType.ID, start)},
		{name: "guest email with spaces", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван","guest_email":"guest name@example.com"}`, meetingType.ID, start)},
		{name: "guest email too long", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":"Иван","guest_email":"%s"}`, meetingType.ID, start, tooLongEmail)},
		{name: "guest name is a number", body: fmt.Sprintf(`{"meeting_type_id":"%s","start_time":"%s","guest_name":42,"guest_email":"guest@example.com"}`, meetingType.ID, start)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, payload := doRequest(t, server, http.MethodPost, "/bookings", test.body)

			assertErrorEnvelope(t, response, payload, http.StatusBadRequest, httpapi.CodeInvalidRequest)
		})
	}
}

func TestCreateBookingMeetingTypeNotFound(t *testing.T) {
	store := meetingtype.NewStore()
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 9, 0)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody("11111111-1111-4111-8111-111111111111", start, "Иван", "guest@example.com"),
	)

	assertErrorEnvelope(t, response, payload, http.StatusNotFound, httpapi.CodeMeetingTypeNotFound)
}

func TestCreateBookingValidationOrder(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	unknownID := "11111111-1111-4111-8111-111111111111"
	server := newTestServer(t, store)
	past := moscowTime(t, time.October, 30, 9, 0)

	t.Run("invalid request wins over unknown meeting type", func(t *testing.T) {
		response, payload := doRequest(t, server, http.MethodPost, "/bookings", `{"meeting_type_id":"not-a-uuid"}`)

		assertErrorEnvelope(t, response, payload, http.StatusBadRequest, httpapi.CodeInvalidRequest)
	})

	t.Run("unknown meeting type wins over an invalid slot", func(t *testing.T) {
		response, payload := doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(unknownID, past, "Иван", "guest@example.com"),
		)

		assertErrorEnvelope(t, response, payload, http.StatusNotFound, httpapi.CodeMeetingTypeNotFound)
	})

	t.Run("invalid slot wins over an occupied slot", func(t *testing.T) {
		// The same start is booked, but the past start must be reported as invalid.
		bookedStart := moscowTime(t, time.November, 16, 9, 0)
		response, payload := doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(meetingType.ID, bookedStart, "Иван", "guest@example.com"),
		)
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("seed booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
		}

		response, payload = doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(meetingType.ID, past, "Иван", "guest@example.com"),
		)

		assertErrorEnvelope(t, response, payload, http.StatusBadRequest, httpapi.CodeInvalidSlot)
	})
}

func TestCreateBookingInvalidSlot(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	longMeeting := createMeetingTypeInStore(t, store, 60)
	server := newTestServer(t, store)

	tests := []struct {
		name  string
		start time.Time
		typ   meetingtype.MeetingType
	}{
		{name: "start in the past", start: moscowTime(t, time.October, 30, 9, 0), typ: meetingType},
		{name: "start outside the booking window", start: moscowTime(t, time.November, 30, 9, 0), typ: meetingType},
		{name: "start on a saturday", start: moscowTime(t, time.November, 21, 9, 0), typ: meetingType},
		{name: "start off the grid", start: moscowTime(t, time.November, 16, 9, 5), typ: meetingType},
		{name: "start before working hours", start: moscowTime(t, time.November, 16, 8, 45), typ: meetingType},
		{name: "start at 18:00", start: moscowTime(t, time.November, 16, 18, 0), typ: meetingType},
		{name: "meeting does not fit working hours", start: moscowTime(t, time.November, 16, 17, 30), typ: longMeeting},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, payload := doRequest(t, server, http.MethodPost, "/bookings",
				bookingRequestBody(test.typ.ID, test.start, "Иван", "guest@example.com"),
			)

			assertErrorEnvelope(t, response, payload, http.StatusBadRequest, httpapi.CodeInvalidSlot)
		})
	}
}

func TestCreateBookingRejectsOverlapAndAllowsBackToBack(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	first := moscowTime(t, time.November, 16, 9, 0)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, first, "Иван", "guest@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("first booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	// Back-to-back: the second meeting starts exactly when the first ends.
	response, payload = doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, first.Add(30*time.Minute), "Пётр", "petr@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("adjacent booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	// Any overlap is forbidden.
	for _, start := range []time.Time{first, first.Add(15 * time.Minute)} {
		response, payload = doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(meetingType.ID, start, "Анна", "anna@example.com"),
		)
		assertErrorEnvelope(t, response, payload, http.StatusConflict, httpapi.CodeSlotTaken)
	}

	// Resending the same request is a conflict as well.
	response, payload = doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, first, "Иван", "guest@example.com"),
	)
	assertErrorEnvelope(t, response, payload, http.StatusConflict, httpapi.CodeSlotTaken)
}

func TestCreateBookingConflictsAcrossMeetingTypes(t *testing.T) {
	store := meetingtype.NewStore()
	firstType := createMeetingTypeInStore(t, store, 30)
	secondType := createMeetingTypeInStore(t, store, 15)
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 10, 0)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(firstType.ID, start, "Иван", "guest@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("first booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	response, payload = doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(secondType.ID, start.Add(15*time.Minute), "Пётр", "petr@example.com"),
	)

	assertErrorEnvelope(t, response, payload, http.StatusConflict, httpapi.CodeSlotTaken)
}

func TestCreateBookingPartialOverlapOfDifferentDurations(t *testing.T) {
	store := meetingtype.NewStore()
	hourLong := createMeetingTypeInStore(t, store, 60)
	halfHour := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	ten := moscowTime(t, time.November, 16, 10, 0)

	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(hourLong.ID, ten, "Иван", "guest@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("60-minute booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	// 10:30 lies inside the booked [10:00, 11:00) interval.
	response, payload = doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(halfHour.ID, ten.Add(30*time.Minute), "Пётр", "petr@example.com"),
	)
	assertErrorEnvelope(t, response, payload, http.StatusConflict, httpapi.CodeSlotTaken)

	// 11:00 is adjacent to the booked interval and must be free.
	response, payload = doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(halfHour.ID, ten.Add(60*time.Minute), "Анна", "anna@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("adjacent 30-minute booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}
}

func TestAvailableSlotsUseTheBookingOverlapRule(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 9, 0)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, start, "Иван", "guest@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("booking status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	response, payload = doRequest(t, server, http.MethodGet, "/available-slots?meeting_type_id="+meetingType.ID, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("slots status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	slots := decodeTimeSlots(t, payload)
	available := func(want time.Time) bool {
		for _, slot := range slots {
			if slot.StartTime.Equal(want) {
				return true
			}
		}

		return false
	}

	if available(start) {
		t.Fatalf("booked slot %s is still offered as available", start)
	}
	if !available(start.Add(30 * time.Minute)) {
		t.Fatalf("adjacent slot %s is missing from available slots", start.Add(30*time.Minute))
	}
}

func TestCreateBookingConcurrentRequestsYieldOneBooking(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 10, 0)
	body := bookingRequestBody(meetingType.ID, start, "Иван", "guest@example.com")

	const racers = 10

	var (
		ready   sync.WaitGroup
		done    sync.WaitGroup
		barrier = make(chan struct{})
		results = make(chan int, racers)
	)
	ready.Add(racers)
	done.Add(racers)

	for range racers {
		go func() {
			defer done.Done()

			request, err := http.NewRequest(http.MethodPost, server.URL+"/bookings", strings.NewReader(body))
			if err != nil {
				results <- -1
				return
			}
			request.Header.Set("Content-Type", "application/json")

			ready.Done()
			<-barrier

			response, err := server.Client().Do(request)
			if err != nil {
				results <- -1
				return
			}
			defer func() {
				_ = response.Body.Close()
			}()

			results <- response.StatusCode
		}()
	}

	ready.Wait()
	close(barrier)
	done.Wait()
	close(results)

	counts := map[int]int{}
	for status := range results {
		counts[status]++
	}

	if counts[http.StatusCreated] != 1 {
		t.Fatalf("201 responses = %d, want 1; all statuses = %v", counts[http.StatusCreated], counts)
	}
	if counts[http.StatusConflict] != racers-1 {
		t.Fatalf("409 responses = %d, want %d; all statuses = %v", counts[http.StatusConflict], racers-1, counts)
	}
	for status := range counts {
		if status >= http.StatusInternalServerError || status < 0 {
			t.Fatalf("unexpected status %d in %v", status, counts)
		}
	}

	response, payload := doRequest(t, server, http.MethodGet, "/bookings", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	var listed []booking.Booking
	if err := json.Unmarshal(payload, &listed); err != nil {
		t.Fatalf("decode bookings %q: %v", payload, err)
	}
	if len(listed) != 1 {
		t.Fatalf("stored bookings = %d, want exactly 1", len(listed))
	}
}

func TestListBookingsReturnsUpcomingSortedByStart(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	now := testNow
	var nowMu sync.Mutex
	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: store,
		Bookings:     booking.NewStore(),
		TimeRules:    mustRules(t, timerules.DefaultConfig()),
		Now: func() time.Time {
			nowMu.Lock()
			defer nowMu.Unlock()

			return now
		},
	})

	later := moscowTime(t, time.November, 16, 10, 0)
	earlier := moscowTime(t, time.November, 16, 9, 0)

	for _, start := range []time.Time{later, earlier} {
		response, payload := doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(meetingType.ID, start, "Иван", "guest@example.com"),
		)
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("booking %s status = %d, want %d; body = %s", start, response.StatusCode, http.StatusCreated, payload)
		}
	}

	response, payload := doRequest(t, server, http.MethodGet, "/bookings", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	var listed []booking.Booking
	if err := json.Unmarshal(payload, &listed); err != nil {
		t.Fatalf("decode bookings %q: %v", payload, err)
	}
	if len(listed) != 2 {
		t.Fatalf("listed %d bookings, want 2", len(listed))
	}
	if !listed[0].StartTime.Equal(earlier) || !listed[1].StartTime.Equal(later) {
		t.Fatalf("list order = [%s %s], want [%s %s]", listed[0].StartTime, listed[1].StartTime, earlier, later)
	}

	// Once the earlier meeting ended, it is no longer listed.
	nowMu.Lock()
	now = earlier.Add(31 * time.Minute)
	nowMu.Unlock()

	response, payload = doRequest(t, server, http.MethodGet, "/bookings", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}
	if err := json.Unmarshal(payload, &listed); err != nil {
		t.Fatalf("decode bookings %q: %v", payload, err)
	}
	if len(listed) != 1 || !listed[0].StartTime.Equal(later) {
		t.Fatalf("upcoming bookings = %+v, want only the later one", listed)
	}
}

func TestListBookingsUsesStrictEndTimeBoundary(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	now := testNow
	var nowMu sync.Mutex
	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: store,
		Bookings:     booking.NewStore(),
		TimeRules:    mustRules(t, timerules.DefaultConfig()),
		Now: func() time.Time {
			nowMu.Lock()
			defer nowMu.Unlock()

			return now
		},
	})

	finished := moscowTime(t, time.November, 16, 9, 0)
	ongoing := moscowTime(t, time.November, 16, 10, 0)
	later := moscowTime(t, time.November, 16, 11, 0)

	for _, start := range []time.Time{finished, ongoing, later} {
		response, payload := doRequest(t, server, http.MethodPost, "/bookings",
			bookingRequestBody(meetingType.ID, start, "Иван", "guest@example.com"),
		)
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("booking %s status = %d, want %d; body = %s", start, response.StatusCode, http.StatusCreated, payload)
		}
	}

	setNow := func(moment time.Time) {
		nowMu.Lock()
		now = moment
		nowMu.Unlock()
	}

	// A booking whose end equals now is over: the response keeps only the
	// meetings that end strictly after now.
	setNow(finished.Add(30 * time.Minute))
	listed := listBookings(t, server)
	if len(listed) != 2 || !listed[0].StartTime.Equal(ongoing) || !listed[1].StartTime.Equal(later) {
		t.Fatalf("at the end boundary listed = %+v, want the two later meetings", listed)
	}

	// A meeting that has started but not ended stays in the list.
	setNow(ongoing.Add(15 * time.Minute))
	listed = listBookings(t, server)
	if len(listed) != 2 || !listed[0].StartTime.Equal(ongoing) || !listed[1].StartTime.Equal(later) {
		t.Fatalf("during the meeting listed = %+v, want the ongoing and the later meeting", listed)
	}

	// Crossing the end boundary of the ongoing meeting removes it as well.
	setNow(ongoing.Add(30 * time.Minute))
	listed = listBookings(t, server)
	if len(listed) != 1 || !listed[0].StartTime.Equal(later) {
		t.Fatalf("after the end boundary listed = %+v, want only the later meeting", listed)
	}
}

func listBookings(t *testing.T, server *httptest.Server) []booking.Booking {
	t.Helper()

	response, payload := doRequest(t, server, http.MethodGet, "/bookings", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}

	var listed []booking.Booking
	if err := json.Unmarshal(payload, &listed); err != nil {
		t.Fatalf("decode bookings %q: %v", payload, err)
	}

	return listed
}

func TestBookingsMethodNotAllowed(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodPut, "/bookings", "{}")

	assertErrorEnvelope(t, response, payload, http.StatusMethodNotAllowed, httpapi.CodeMethodNotAllowed)
}

func TestListBookingsStoreFailureReturnsInternalError(t *testing.T) {
	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: meetingtype.NewStore(),
		Bookings:     failingBookingStore{},
		TimeRules:    mustRules(t, timerules.DefaultConfig()),
		Now:          func() time.Time { return testNow },
	})

	response, payload := doRequest(t, server, http.MethodGet, "/bookings", "")

	assertErrorEnvelope(t, response, payload, http.StatusInternalServerError, httpapi.CodeInternalError)
}

func TestCreateBookingReturnsInternalErrorWhenStoreCannotWrite(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 30)
	server := newTestServerWith(t, httpapi.Deps{
		MeetingTypes: store,
		Bookings:     failingBookingStore{},
		TimeRules:    mustRules(t, timerules.DefaultConfig()),
		Now:          func() time.Time { return testNow },
	})

	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, moscowTime(t, time.November, 16, 9, 0), "Иван", "guest@example.com"),
	)

	assertErrorEnvelope(t, response, payload, http.StatusInternalServerError, httpapi.CodeInternalError)
}

func TestCreateBookingDurationComesFromMeetingType(t *testing.T) {
	store := meetingtype.NewStore()
	meetingType := createMeetingTypeInStore(t, store, 15)
	server := newTestServer(t, store)

	start := moscowTime(t, time.November, 16, 9, 15)
	response, payload := doRequest(t, server, http.MethodPost, "/bookings",
		bookingRequestBody(meetingType.ID, start, "Иван", "guest@example.com"),
	)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	created := decodeBooking(t, payload)
	if duration := created.EndTime.Sub(created.StartTime); duration != 15*time.Minute {
		t.Fatalf("booking duration = %s, want 15m", duration)
	}
}

// failingBookingStore fails every booking operation so the HTTP layer can be
// observed mapping store failures to internal_error.
type failingBookingStore struct{}

func (failingBookingStore) Busy() []timerules.Interval {
	return nil
}

func (failingBookingStore) List() ([]booking.Booking, error) {
	return nil, fmt.Errorf("store unavailable")
}

func (failingBookingStore) Create(booking.CreateInput, booking.ValidateSlot) (booking.Booking, error) {
	return booking.Booking{}, fmt.Errorf("store unavailable")
}
