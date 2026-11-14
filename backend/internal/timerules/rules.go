// Package timerules holds the owner's time rules: the booking window, working
// days and hours, the start grid and the slot generation built on top of them.
//
// All calendar calculations happen in the owner timezone and never read the
// host clock; callers inject the current instant.
package timerules

import (
	"fmt"
	"time"
	// Embed the IANA database so the owner timezone resolves the same way on
	// hosts without system tzdata.
	_ "time/tzdata"
)

// Time constants of the single owner calendar. They are deliberately not
// overridable through environment variables.
const (
	OwnerTimezone             = "Europe/Moscow"
	WorkingHoursStart         = "09:00"
	WorkingHoursEnd           = "18:00"
	SlotStepMinutes           = 15
	BookingWindowDays         = 14
	MaxMeetingDurationMinutes = 480
)

// Config describes the time rules. Values are kept close to the contract
// representation so they can be served by GET /config as-is.
type Config struct {
	Timezone                  string
	WorkingHoursStart         string
	WorkingHoursEnd           string
	SlotStepMinutes           int
	BookingWindowDays         int
	MaxMeetingDurationMinutes int
}

// DefaultConfig returns the fixed configuration of the owner calendar.
func DefaultConfig() Config {
	return Config{
		Timezone:                  OwnerTimezone,
		WorkingHoursStart:         WorkingHoursStart,
		WorkingHoursEnd:           WorkingHoursEnd,
		SlotStepMinutes:           SlotStepMinutes,
		BookingWindowDays:         BookingWindowDays,
		MaxMeetingDurationMinutes: MaxMeetingDurationMinutes,
	}
}

// Slot is a bookable interval: a grid start inside working hours plus the
// duration of the selected meeting type.
type Slot struct {
	Start time.Time
	End   time.Time
}

// Interval is an occupied half-open time range [Start, End).
type Interval struct {
	Start time.Time
	End   time.Time
}

// Rules is a validated time configuration ready to generate slots.
type Rules struct {
	config    Config
	location  *time.Location
	workStart time.Duration
	workEnd   time.Duration
	step      time.Duration
}

// New validates the configuration and builds the rules. A working day shorter
// than the maximum meeting duration is a configuration error: no meeting type
// could fit into it.
func New(config Config) (Rules, error) {
	if config.SlotStepMinutes <= 0 {
		return Rules{}, fmt.Errorf("slot step must be positive, got %d minutes", config.SlotStepMinutes)
	}
	if config.BookingWindowDays <= 0 {
		return Rules{}, fmt.Errorf("booking window must be positive, got %d days", config.BookingWindowDays)
	}
	if config.MaxMeetingDurationMinutes <= 0 {
		return Rules{}, fmt.Errorf("maximum meeting duration must be positive, got %d minutes", config.MaxMeetingDurationMinutes)
	}

	location, err := time.LoadLocation(config.Timezone)
	if err != nil {
		return Rules{}, fmt.Errorf("load timezone %q: %w", config.Timezone, err)
	}

	workStart, err := parseClock(config.WorkingHoursStart)
	if err != nil {
		return Rules{}, fmt.Errorf("parse working hours start: %w", err)
	}
	workEnd, err := parseClock(config.WorkingHoursEnd)
	if err != nil {
		return Rules{}, fmt.Errorf("parse working hours end: %w", err)
	}
	if workEnd <= workStart {
		return Rules{}, fmt.Errorf("working hours end %s must be after start %s", config.WorkingHoursEnd, config.WorkingHoursStart)
	}

	workdayMinutes := int((workEnd - workStart) / time.Minute)
	if workdayMinutes < config.MaxMeetingDurationMinutes {
		return Rules{}, fmt.Errorf(
			"working day is %d minutes, want at least the maximum meeting duration of %d minutes",
			workdayMinutes,
			config.MaxMeetingDurationMinutes,
		)
	}

	return Rules{
		config:    config,
		location:  location,
		workStart: workStart,
		workEnd:   workEnd,
		step:      time.Duration(config.SlotStepMinutes) * time.Minute,
	}, nil
}

// Config returns the configuration the rules were built from.
func (r Rules) Config() Config {
	return r.config
}

// Location returns the owner timezone.
func (r Rules) Location() *time.Location {
	return r.location
}

// Today returns midnight of the owner calendar date containing now.
func (r Rules) Today(now time.Time) time.Time {
	local := now.In(r.location)

	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, r.location)
}

// Slots returns every free slot of the booking window [today, today+N-1].
// Working days are Monday to Friday; starts live on the grid anchored at the
// working day start and run while the whole slot fits into working hours.
// Starts at or before now and starts overlapping any busy interval are skipped.
func (r Rules) Slots(now time.Time, durationMinutes int, busy []Interval) []Slot {
	slots := make([]Slot, 0)
	if durationMinutes <= 0 {
		return slots
	}

	duration := time.Duration(durationMinutes) * time.Minute
	today := r.Today(now)

	for offset := 0; offset < r.config.BookingWindowDays; offset++ {
		day := today.AddDate(0, 0, offset)
		if weekday := day.Weekday(); weekday == time.Saturday || weekday == time.Sunday {
			continue
		}

		dayEnd := day.Add(r.workEnd)
		for start := day.Add(r.workStart); !start.Add(duration).After(dayEnd); start = start.Add(r.step) {
			end := start.Add(duration)
			if !start.After(now) {
				continue
			}
			if overlapsAny(start, end, busy) {
				continue
			}

			slots = append(slots, Slot{Start: start, End: end})
		}
	}

	return slots
}

// Overlaps reports whether two half-open intervals intersect. Back-to-back
// intervals do not overlap.
func Overlaps(startA, endA, startB, endB time.Time) bool {
	return startB.Before(endA) && startA.Before(endB)
}

func overlapsAny(start, end time.Time, busy []Interval) bool {
	for _, interval := range busy {
		if Overlaps(start, end, interval.Start, interval.End) {
			return true
		}
	}

	return false
}

func parseClock(value string) (time.Duration, error) {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0, fmt.Errorf("parse clock %q as HH:MM: %w", value, err)
	}

	return time.Duration(parsed.Hour())*time.Hour + time.Duration(parsed.Minute())*time.Minute, nil
}
