package httpapi_test

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/httpapi"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type failingStore struct{}

func (failingStore) List() ([]meetingtype.MeetingType, error) {
	return nil, errors.New("store unavailable")
}

func (failingStore) Create(meetingtype.CreateInput) (meetingtype.MeetingType, error) {
	return meetingtype.MeetingType{}, errors.New("store unavailable")
}

func newTestServer(t *testing.T, store httpapi.MeetingTypeStore) *httptest.Server {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := httptest.NewServer(httpapi.NewRouter(logger, "http://localhost:5173", store))
	t.Cleanup(server.Close)

	return server
}

func doRequest(t *testing.T, server *httptest.Server, method, path, body string) (*http.Response, []byte) {
	t.Helper()

	request, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("create %s %s request: %v", method, path, err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() {
		_ = response.Body.Close()
	}()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read %s %s response: %v", method, path, err)
	}

	return response, payload
}

func decodeMeetingType(t *testing.T, payload []byte) meetingtype.MeetingType {
	t.Helper()

	var meetingType meetingtype.MeetingType
	if err := json.Unmarshal(payload, &meetingType); err != nil {
		t.Fatalf("decode meeting type %q: %v", payload, err)
	}

	return meetingType
}

func assertErrorEnvelope(t *testing.T, response *http.Response, payload []byte, status int, code string) {
	t.Helper()

	if response.StatusCode != status {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, status, payload)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want %q", contentType, "application/json")
	}

	var body errorResponse
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode error response %q: %v", payload, err)
	}
	if body.Code != code {
		t.Fatalf("error code = %q, want %q", body.Code, code)
	}
	if body.Message == "" {
		t.Fatal("error message is empty")
	}
}

func TestListMeetingTypesReturnsEmptyArray(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodGet, "/meeting-types", "")

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusOK, payload)
	}
	if got := strings.TrimSpace(string(payload)); got != "[]" {
		t.Fatalf("body = %s, want []", got)
	}
}

func TestCreateMeetingTypeTrimsAndReturnsCreatedType(t *testing.T) {
	store := meetingtype.NewStore()
	server := newTestServer(t, store)

	response, payload := doRequest(t, server, http.MethodPost, "/meeting-types", `{
		"title": "  Встреча 30 минут  ",
		"description": "  Описание встречи  ",
		"duration_minutes": 30,
		"unknown_field": "ignored"
	}`)

	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
	}

	created := decodeMeetingType(t, payload)
	if !uuidV4Pattern.MatchString(created.ID) {
		t.Fatalf("id = %q, want UUID v4", created.ID)
	}
	if created.Title != "Встреча 30 минут" {
		t.Fatalf("title = %q, want trimmed title", created.Title)
	}
	if created.Description != "Описание встречи" {
		t.Fatalf("description = %q, want trimmed description", created.Description)
	}
	if created.DurationMinutes != 30 {
		t.Fatalf("duration_minutes = %d, want 30", created.DurationMinutes)
	}

	listResponse, listPayload := doRequest(t, server, http.MethodGet, "/meeting-types?ignored=1", "")
	if listResponse.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want %d", listResponse.StatusCode, http.StatusOK)
	}

	var listed []meetingtype.MeetingType
	if err := json.Unmarshal(listPayload, &listed); err != nil {
		t.Fatalf("decode meeting types %q: %v", listPayload, err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed %d meeting types, want 1", len(listed))
	}
	if listed[0] != created {
		t.Fatalf("listed meeting type = %+v, want %+v", listed[0], created)
	}
}

func TestCreateMeetingTypeAllowsDuplicateTitlesInCreationOrder(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	firstResponse, firstPayload := doRequest(t, server, http.MethodPost, "/meeting-types", `{"title":"Звонок","description":"","duration_minutes":15}`)
	if firstResponse.StatusCode != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body = %s", firstResponse.StatusCode, http.StatusCreated, firstPayload)
	}
	secondResponse, secondPayload := doRequest(t, server, http.MethodPost, "/meeting-types", `{"title":"Звонок","description":"","duration_minutes":45}`)
	if secondResponse.StatusCode != http.StatusCreated {
		t.Fatalf("second status = %d, want %d; body = %s", secondResponse.StatusCode, http.StatusCreated, secondPayload)
	}

	first := decodeMeetingType(t, firstPayload)
	second := decodeMeetingType(t, secondPayload)
	if first.Description != "" {
		t.Fatalf("empty description = %q, want empty string", first.Description)
	}

	_, listPayload := doRequest(t, server, http.MethodGet, "/meeting-types", "")
	var listed []meetingtype.MeetingType
	if err := json.Unmarshal(listPayload, &listed); err != nil {
		t.Fatalf("decode meeting types %q: %v", listPayload, err)
	}
	if len(listed) != 2 {
		t.Fatalf("listed %d meeting types, want 2", len(listed))
	}
	if listed[0].ID != first.ID || listed[1].ID != second.ID {
		t.Fatalf("list order = [%s %s], want [%s %s]", listed[0].ID, listed[1].ID, first.ID, second.ID)
	}
}

func TestCreateMeetingTypeValidation(t *testing.T) {
	tooLongTitle := strings.Repeat("я", 101)
	tooLongDescription := strings.Repeat("я", 501)
	oversizedBody := `{"title":"` + strings.Repeat("a", 1<<20) + `","description":"","duration_minutes":30}`

	tests := []struct {
		name string
		body string
	}{
		{name: "empty body", body: ""},
		{name: "invalid json", body: `{"title":`},
		{name: "trailing json", body: `{"title":"Звонок","description":"","duration_minutes":30}{}`},
		{name: "missing title", body: `{"description":"","duration_minutes":30}`},
		{name: "blank title", body: `{"title":"   ","description":"","duration_minutes":30}`},
		{name: "title too long", body: `{"title":"` + tooLongTitle + `","description":"","duration_minutes":30}`},
		{name: "missing description", body: `{"title":"Звонок","duration_minutes":30}`},
		{name: "description too long", body: `{"title":"Звонок","description":"` + tooLongDescription + `","duration_minutes":30}`},
		{name: "missing duration", body: `{"title":"Звонок","description":""}`},
		{name: "duration too small", body: `{"title":"Звонок","description":"","duration_minutes":4}`},
		{name: "duration too large", body: `{"title":"Звонок","description":"","duration_minutes":481}`},
		{name: "duration is a string", body: `{"title":"Звонок","description":"","duration_minutes":"30"}`},
		{name: "duration is fractional", body: `{"title":"Звонок","description":"","duration_minutes":30.5}`},
		{name: "body too large", body: oversizedBody},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newTestServer(t, meetingtype.NewStore())

			response, payload := doRequest(t, server, http.MethodPost, "/meeting-types", test.body)

			assertErrorEnvelope(t, response, payload, http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestCreateMeetingTypeAcceptsBoundaryValues(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "minimum boundaries",
			body: `{"title":"` + strings.Repeat("я", 100) + `","description":"","duration_minutes":5}`,
		},
		{
			name: "maximum boundaries",
			body: `{"title":"Звонок","description":"` + strings.Repeat("я", 500) + `","duration_minutes":480}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newTestServer(t, meetingtype.NewStore())

			response, payload := doRequest(t, server, http.MethodPost, "/meeting-types", test.body)

			if response.StatusCode != http.StatusCreated {
				t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, http.StatusCreated, payload)
			}
		})
	}
}

func TestMeetingTypesMethodNotAllowed(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodPut, "/meeting-types", `{}`)

	assertErrorEnvelope(t, response, payload, http.StatusMethodNotAllowed, "method_not_allowed")
}

func TestUnknownPathReturnsNotFound(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, payload := doRequest(t, server, http.MethodGet, "/unknown", "")

	assertErrorEnvelope(t, response, payload, http.StatusNotFound, "not_found")
}

func TestStoreFailureReturnsInternalError(t *testing.T) {
	server := newTestServer(t, failingStore{})

	t.Run("list", func(t *testing.T) {
		response, payload := doRequest(t, server, http.MethodGet, "/meeting-types", "")

		assertErrorEnvelope(t, response, payload, http.StatusInternalServerError, "internal_error")
	})

	t.Run("create", func(t *testing.T) {
		response, payload := doRequest(t, server, http.MethodPost, "/meeting-types", `{"title":"Звонок","description":"","duration_minutes":30}`)

		assertErrorEnvelope(t, response, payload, http.StatusInternalServerError, "internal_error")
	})
}
