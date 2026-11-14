// Package booking implements the in-memory store of guest bookings. Occupancy
// is shared across meeting types, and slot validation plus insertion happen in
// one critical section so two guests can never book overlapping intervals.
package booking

import (
	"errors"
	"sync"
	"time"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/uuid"
)

// ErrInvalidSlot reports a start that does not exist under the calendar rules:
// in the past, outside the booking window, off the start grid or not fitting
// into working hours.
var ErrInvalidSlot = errors.New("invalid slot")

// ErrSlotTaken reports a valid start that overlaps an existing booking.
var ErrSlotTaken = errors.New("slot taken")

// Booking is a confirmed guest booking of a meeting type interval.
type Booking struct {
	ID            string    `json:"id"`
	MeetingTypeID string    `json:"meeting_type_id"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	GuestName     string    `json:"guest_name"`
	GuestEmail    string    `json:"guest_email"`
}

// CreateInput carries request fields validated by the HTTP layer. The end time
// is always derived from the meeting type duration.
type CreateInput struct {
	MeetingTypeID   string
	StartTime       time.Time
	DurationMinutes int
	GuestName       string
	GuestEmail      string
}

// ValidateSlot checks a candidate interval against the calendar rules and the
// current occupancy snapshot. The store calls it inside its write lock, so it
// must not touch the store itself.
type ValidateSlot func(start, end time.Time, busy []timerules.Interval) error

// Store keeps bookings in process memory. It is safe for concurrent use.
type Store struct {
	mu    sync.RWMutex
	items []Booking
}

func NewStore() *Store {
	return &Store{items: make([]Booking, 0)}
}

// Create validates the slot and inserts the booking in a single critical
// section. It returns ErrInvalidSlot or ErrSlotTaken from the validator.
func (s *Store) Create(input CreateInput, validate ValidateSlot) (Booking, error) {
	endTime := input.StartTime.Add(time.Duration(input.DurationMinutes) * time.Minute)

	id, err := uuid.New()
	if err != nil {
		return Booking{}, err
	}

	booking := Booking{
		ID:            id,
		MeetingTypeID: input.MeetingTypeID,
		StartTime:     input.StartTime.UTC(),
		EndTime:       endTime.UTC(),
		GuestName:     input.GuestName,
		GuestEmail:    input.GuestEmail,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if validate != nil {
		if err := validate(booking.StartTime, booking.EndTime, s.busyLocked()); err != nil {
			return Booking{}, err
		}
	}

	s.items = append(s.items, booking)

	return booking, nil
}

// Busy returns a snapshot of the occupied half-open intervals of every booking.
func (s *Store) Busy() []timerules.Interval {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.busyLocked()
}

func (s *Store) busyLocked() []timerules.Interval {
	intervals := make([]timerules.Interval, len(s.items))
	for index, item := range s.items {
		intervals[index] = timerules.Interval{Start: item.StartTime, End: item.EndTime}
	}

	return intervals
}

// List returns a snapshot of every stored booking in insertion order.
func (s *Store) List() ([]Booking, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Booking, len(s.items))
	copy(items, s.items)

	return items, nil
}
