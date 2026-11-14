package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
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
