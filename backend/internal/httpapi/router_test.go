package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/booking"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/httpapi"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
)

func TestHealthEndpoint(t *testing.T) {
	server := newTestServer(t, meetingtype.NewStore())

	response, err := server.Client().Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer func() {
		_ = response.Body.Close()
	}()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status = %q, want %q", body.Status, "ok")
	}
}

func TestCORSPreflightReturnsNoContent(t *testing.T) {
	const allowedOrigin = "http://localhost:5173"
	server := newTestServerWith(t, httpapi.Deps{
		AllowedOrigin: allowedOrigin,
		MeetingTypes:  meetingtype.NewStore(),
		TimeRules:     mustRules(t, timerules.DefaultConfig()),
		Bookings:      booking.NewStore(),
		Now:           func() time.Time { return testNow },
	})

	request, err := http.NewRequest(http.MethodOptions, server.URL+"/bookings", nil)
	if err != nil {
		t.Fatalf("create OPTIONS request: %v", err)
	}
	request.Header.Set("Origin", allowedOrigin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type")

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("OPTIONS /bookings: %v", err)
	}
	defer func() {
		_ = response.Body.Close()
	}()

	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
	if got := response.Header.Get("Access-Control-Allow-Origin"); got != allowedOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, allowedOrigin)
	}
	if got := response.Header.Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q, want GET, POST, OPTIONS", got)
	}
	if got := response.Header.Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Content-Type", got)
	}
}
