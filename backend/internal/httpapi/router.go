package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/meetingtype"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
)

const maxRequestBodyBytes = 1 << 20

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// MeetingTypeStore is the catalog dependency required by the HTTP layer.
type MeetingTypeStore interface {
	List() ([]meetingtype.MeetingType, error)
	Create(meetingtype.CreateInput) (meetingtype.MeetingType, error)
}

// BusyProvider returns a snapshot of the intervals occupied by bookings of
// every meeting type. Occupancy is shared across meeting types.
type BusyProvider interface {
	Busy() []timerules.Interval
}

// Deps are the explicit dependencies of the HTTP layer.
type Deps struct {
	Logger        *slog.Logger
	AllowedOrigin string
	MeetingTypes  MeetingTypeStore
	TimeRules     timerules.Rules
	Busy          BusyProvider
	Now           func() time.Time
}

type api struct {
	logger       *slog.Logger
	meetingTypes MeetingTypeStore
	rules        timerules.Rules
	busy         BusyProvider
	now          func() time.Time
}

func NewRouter(deps Deps) http.Handler {
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}

	handler := &api{
		logger:       logger,
		meetingTypes: deps.MeetingTypes,
		rules:        deps.TimeRules,
		busy:         deps.Busy,
		now:          now,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet: handler.handleHealth,
		},
	))
	mux.HandleFunc("/config", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet: handler.handleGetConfig,
		},
	))
	mux.HandleFunc("/meeting-types", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet:  handler.handleListMeetingTypes,
			http.MethodPost: handler.handleCreateMeetingType,
		},
	))
	mux.HandleFunc("/available-slots", methodNotAllowedHandler(
		map[string]http.HandlerFunc{
			http.MethodGet: handler.handleListAvailableSlots,
		},
	))
	mux.HandleFunc("/", handler.handleNotFound)

	return withCORS(deps.AllowedOrigin, withRequestLogging(logger, mux))
}

func (a *api) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type configResponse struct {
	Timezone          string `json:"timezone"`
	WorkingHoursStart string `json:"working_hours_start"`
	WorkingHoursEnd   string `json:"working_hours_end"`
	SlotStepMinutes   int    `json:"slot_step_minutes"`
	BookingWindowDays int    `json:"booking_window_days"`
	Today             string `json:"today"`
}

func (a *api) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	config := a.rules.Config()

	writeJSON(w, http.StatusOK, configResponse{
		Timezone:          config.Timezone,
		WorkingHoursStart: config.WorkingHoursStart,
		WorkingHoursEnd:   config.WorkingHoursEnd,
		SlotStepMinutes:   config.SlotStepMinutes,
		BookingWindowDays: config.BookingWindowDays,
		Today:             a.rules.Today(a.now()).Format(time.DateOnly),
	})
}

type timeSlotResponse struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
}

func (a *api) handleListAvailableSlots(w http.ResponseWriter, r *http.Request) {
	meetingTypeID := r.URL.Query().Get("meeting_type_id")
	if !uuidPattern.MatchString(meetingTypeID) {
		writeError(w, http.StatusBadRequest, CodeInvalidRequest, "Некорректный идентификатор типа встречи")
		return
	}

	meetingTypes, err := a.meetingTypes.List()
	if err != nil {
		a.logger.Error("list meeting types for available slots", "error", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Внутренняя ошибка сервера")
		return
	}

	var meetingType *meetingtype.MeetingType
	for index := range meetingTypes {
		if meetingTypes[index].ID == meetingTypeID {
			meetingType = &meetingTypes[index]
			break
		}
	}
	if meetingType == nil {
		writeError(w, http.StatusNotFound, CodeMeetingTypeNotFound, "Тип встречи не найден")
		return
	}

	var busy []timerules.Interval
	if a.busy != nil {
		busy = a.busy.Busy()
	}

	slots := a.rules.Slots(a.now(), meetingType.DurationMinutes, busy)
	slices.SortFunc(slots, func(left, right timerules.Slot) int {
		return left.Start.Compare(right.Start)
	})

	response := make([]timeSlotResponse, len(slots))
	for index, slot := range slots {
		response[index] = timeSlotResponse{
			StartTime: slot.Start.UTC(),
			EndTime:   slot.End.UTC(),
		}
	}

	writeJSON(w, http.StatusOK, response)
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
