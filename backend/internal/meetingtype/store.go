// Package meetingtype implements the in-memory catalog of meeting types.
package meetingtype

import (
	"fmt"
	"sync"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/uuid"
)

// MeetingType is a published reason for a call.
type MeetingType struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	DurationMinutes int    `json:"duration_minutes"`
}

// CreateInput carries validated meeting type fields.
type CreateInput struct {
	Title           string
	Description     string
	DurationMinutes int
}

// Store keeps meeting types in creation order.
type Store struct {
	mu    sync.RWMutex
	items []MeetingType
}

func NewStore() *Store {
	return &Store{items: make([]MeetingType, 0)}
}

// List returns a snapshot of all meeting types in creation order.
func (s *Store) List() ([]MeetingType, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]MeetingType, len(s.items))
	copy(items, s.items)

	return items, nil
}

// Create appends a meeting type with a server-generated UUID v4.
func (s *Store) Create(input CreateInput) (MeetingType, error) {
	id, err := uuid.New()
	if err != nil {
		return MeetingType{}, fmt.Errorf("generate meeting type id: %w", err)
	}

	meetingType := MeetingType{
		ID:              id,
		Title:           input.Title,
		Description:     input.Description,
		DurationMinutes: input.DurationMinutes,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, meetingType)

	return meetingType, nil
}
