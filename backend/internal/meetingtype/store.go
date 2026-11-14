// Package meetingtype implements the in-memory catalog of meeting types.
package meetingtype

import (
	"crypto/rand"
	"fmt"
	"sync"
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
	id, err := newUUID()
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

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}

	// RFC 9562 version 4 and variant bits.
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80

	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
