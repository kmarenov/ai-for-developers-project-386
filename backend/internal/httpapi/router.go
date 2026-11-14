package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
)

const maxRequestBodyBytes = 1 << 20

// MeetingTypeStore is the catalog dependency required by the HTTP layer.
type MeetingTypeStore interface {
	List() ([]meetingtype.MeetingType, error)
	Create(meetingtype.CreateInput) (meetingtype.MeetingType, error)
}

type api struct {
	logger       *slog.Logger
	meetingTypes MeetingTypeStore
}

func NewRouter(logger *slog.Logger, allowedOrigin string, meetingTypes MeetingTypeStore) http.Handler {
	handler := &api{
		logger:       logger,
		meetingTypes: meetingTypes,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet: handler.handleHealth,
		},
	))
	mux.HandleFunc("/meeting-types", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet:  handler.handleListMeetingTypes,
			http.MethodPost: handler.handleCreateMeetingType,
		},
	))
	mux.HandleFunc("/", handler.handleNotFound)

	return withCORS(allowedOrigin, withRequestLogging(logger, mux))
}

func (a *api) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *api) handleNotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, CodeNotFound, "Ресурс не найден")
}

func (a *api) handleListMeetingTypes(w http.ResponseWriter, _ *http.Request) {
	meetingTypes, err := a.meetingTypes.List()
	if err != nil {
		a.logger.Error("list meeting types", "error", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Внутренняя ошибка сервера")
		return
	}

	writeJSON(w, http.StatusOK, meetingTypes)
}

type createMeetingTypeRequest struct {
	Title           *string `json:"title"`
	Description     *string `json:"description"`
	DurationMinutes *int    `json:"duration_minutes"`
}

func (a *api) handleCreateMeetingType(w http.ResponseWriter, r *http.Request) {
	request, ok := decodeCreateMeetingTypeRequest(w, r)
	if !ok {
		writeError(w, http.StatusBadRequest, CodeInvalidRequest, "Некорректные данные типа встречи")
		return
	}

	input, ok := validateCreateMeetingTypeRequest(request)
	if !ok {
		writeError(w, http.StatusBadRequest, CodeInvalidRequest, "Некорректные данные типа встречи")
		return
	}

	meetingType, err := a.meetingTypes.Create(input)
	if err != nil {
		a.logger.Error("create meeting type", "error", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Внутренняя ошибка сервера")
		return
	}

	writeJSON(w, http.StatusCreated, meetingType)
}

func decodeCreateMeetingTypeRequest(w http.ResponseWriter, r *http.Request) (createMeetingTypeRequest, bool) {
	var request createMeetingTypeRequest

	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes))
	if err := decoder.Decode(&request); err != nil {
		return createMeetingTypeRequest{}, false
	}

	// Reject trailing JSON values while still allowing trailing whitespace.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return createMeetingTypeRequest{}, false
	}

	return request, true
}

func validateCreateMeetingTypeRequest(request createMeetingTypeRequest) (meetingtype.CreateInput, bool) {
	if request.Title == nil || request.Description == nil || request.DurationMinutes == nil {
		return meetingtype.CreateInput{}, false
	}

	title := strings.TrimSpace(*request.Title)
	description := strings.TrimSpace(*request.Description)
	duration := *request.DurationMinutes

	if utf8.RuneCountInString(title) < 1 || utf8.RuneCountInString(title) > 100 {
		return meetingtype.CreateInput{}, false
	}
	if utf8.RuneCountInString(description) > 500 {
		return meetingtype.CreateInput{}, false
	}
	if duration < 5 || duration > 480 {
		return meetingtype.CreateInput{}, false
	}

	return meetingtype.CreateInput{
		Title:           title,
		Description:     description,
		DurationMinutes: duration,
	}, true
}

func methodNotAllowedHandler(handlers map[string]http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if handler, ok := handlers[r.Method]; ok {
			handler(w, r)
			return
		}

		writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed, "Метод не поддерживается")
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func withCORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Vary", "Origin")

		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func withRequestLogging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"duration", time.Since(start),
		)
	})
}
