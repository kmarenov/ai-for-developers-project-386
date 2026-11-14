package httpapi

import "net/http"

// Machine-readable error codes shared by all API errors. The contract keeps
// this catalog closed; clients map these codes to their own UI states.
const (
	CodeInvalidRequest      = "invalid_request"
	CodeInvalidSlot         = "invalid_slot"
	CodeMeetingTypeNotFound = "meeting_type_not_found"
	CodeSlotTaken           = "slot_taken"
	CodeNotFound            = "not_found"
	CodeMethodNotAllowed    = "method_not_allowed"
	CodeInternalError       = "internal_error"
)

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Code: code, Message: message})
}
