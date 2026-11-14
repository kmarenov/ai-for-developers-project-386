package timerules_test

import (
	"testing"
	"time"

	"github.com/kmarenov/ai-for-developers-project-386/backend/internal/timerules"
)

func newRules(t *testing.T, config timerules.Config) timerules.Rules {
	t.Helper()

	rules, err := timerules.New(config)
	if err != nil {
		t.Fatalf("new rules: %v", err)
	}

	return rules
}

func containsStart(slots []timerules.Slot, start time.Time) bool {
	for _, slot := range slots {
		if slot.Start.Equal(start) {
			return true
		}
	}

	return false
}

func TestSlotsUseOwnerDateIndependentOfHostTimezone(t *testing.T) {
	originalLocal := time.Local
	time.Local = time.FixedZone("HOST", -11*60*60)
	t.Cleanup(func() {
		time.Local = originalLocal
	})

	rules := newRules(t, timerules.DefaultConfig())

	// Friday 03:30 in Moscow, still Thursday in the fake host timezone.
	now := time.Date(2026, time.November, 20, 0, 30, 0, 0, time.UTC)

	if got := rules.Today(now).Format(time.DateOnly); got != "2026-11-20" {
		t.Fatalf("today = %q, want owner date 2026-11-20", got)
	}

	slots := rules.Slots(now, 30, nil)
	if len(slots) == 0 {
		t.Fatal("slots are empty, want a 14-day window")
	}

	last := slots[len(slots)-1]
	wantLast := time.Date(2026, time.December, 3, 17, 30, 0, 0, rules.Location())
	if !last.Start.Equal(wantLast) {
		t.Fatalf("last slot start = %s, want %s", last.Start, wantLast)
	}
}

func TestSlotsStayInsideWindowAndSkipWeekends(t *testing.T) {
	rules := newRules(t, timerules.DefaultConfig())

	// Saturday 03:00 in Moscow.
	now := time.Date(2026, time.November, 14, 0, 0, 0, 0, time.UTC)
	slots := rules.Slots(now, 30, nil)

	first := time.Date(2026, time.November, 16, 9, 0, 0, 0, rules.Location())
	if len(slots) == 0 {
		t.Fatal("slots are empty, want a 14-day window")
	}
	if !slots[0].Start.Equal(first) {
		t.Fatalf("first slot = %s, want Monday %s", slots[0].Start, first)
	}

	last := slots[len(slots)-1]
	wantLast := time.Date(2026, time.November, 27, 17, 30, 0, 0, rules.Location())
	if !last.Start.Equal(wantLast) {
		t.Fatalf("last slot start = %s, want %s", last.Start, wantLast)
	}

	if len(slots) != 350 {
		t.Fatalf("slots = %d, want 10 working days x 35 starts", len(slots))
	}

	for _, slot := range slots {
		local := slot.Start.In(rules.Location())
		if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
			t.Fatalf("slot %s falls on a weekend", local)
		}
		if local.Before(time.Date(2026, time.November, 16, 0, 0, 0, 0, rules.Location())) {
			t.Fatalf("slot %s is before the window start", local)
		}
		if local.After(time.Date(2026, time.November, 27, 23, 59, 0, 0, rules.Location())) {
			t.Fatalf("slot %s is after the window end", local)
		}
	}
}

func TestSlotGridRunsFromNineWithSlotStep(t *testing.T) {
	rules := newRules(t, timerules.DefaultConfig())

	now := time.Date(2026, time.November, 14, 0, 0, 0, 0, time.UTC)
	slots := rules.Slots(now, 30, nil)

	day := time.Date(2026, time.November, 16, 0, 0, 0, 0, rules.Location())
	var starts []time.Time
	for _, slot := range slots {
		if slot.Start.In(rules.Location()).Format(time.DateOnly) == day.Format(time.DateOnly) {
			starts = append(starts, slot.Start)
		}
	}

	if len(starts) != 35 {
		t.Fatalf("Monday starts = %d, want 35", len(starts))
	}

	wantFirst := time.Date(2026, time.November, 16, 9, 0, 0, 0, rules.Location())
	if !starts[0].Equal(wantFirst) {
		t.Fatalf("first start = %s, want %s", starts[0], wantFirst)
	}

	for index, start := range starts {
		want := wantFirst.Add(time.Duration(index) * 15 * time.Minute)
		if !start.Equal(want) {
			t.Fatalf("start[%d] = %s, want %s", index, start, want)
		}

		end := start.Add(30 * time.Minute)
		if end.After(time.Date(2026, time.November, 16, 18, 0, 0, 0, rules.Location())) {
			t.Fatalf("slot %s ends at %s, after working hours end", start, end)
		}
	}

	wantLast := time.Date(2026, time.November, 16, 17, 30, 0, 0, rules.Location())
	if !starts[len(starts)-1].Equal(wantLast) {
		t.Fatalf("last start = %s, want %s", starts[len(starts)-1], wantLast)
	}

	for _, slot := range slots {
		duration := slot.End.Sub(slot.Start)
		if duration != 30*time.Minute {
			t.Fatalf("slot %s duration = %s, want 30m", slot.Start, duration)
		}
	}
}

func TestSlotsSkipStartsAtOrBeforeNow(t *testing.T) {
	rules := newRules(t, timerules.DefaultConfig())

	// Friday 09:00 in Moscow: the 09:00 slot is not strictly after now.
	now := time.Date(2026, time.November, 20, 6, 0, 0, 0, time.UTC)
	slots := rules.Slots(now, 30, nil)

	wantFirst := time.Date(2026, time.November, 20, 9, 15, 0, 0, rules.Location())
	if len(slots) == 0 {
		t.Fatal("slots are empty, want remaining Friday starts")
	}
	if !slots[0].Start.Equal(wantFirst) {
		t.Fatalf("first slot = %s, want %s", slots[0].Start, wantFirst)
	}

	for _, slot := range slots {
		if !slot.Start.After(now) {
			t.Fatalf("slot %s does not start strictly after now %s", slot.Start, now)
		}
	}
}

func TestSlotsReturnEmptyResultWhenNoWorkingDayRemains(t *testing.T) {
	config := timerules.DefaultConfig()
	config.BookingWindowDays = 1
	rules := newRules(t, config)

	// Saturday is the only day of this window and it has no starts.
	now := time.Date(2026, time.November, 14, 0, 0, 0, 0, time.UTC)
	slots := rules.Slots(now, 30, nil)

	if len(slots) != 0 {
		t.Fatalf("slots = %d, want an empty result", len(slots))
	}
}

func TestSlotsExcludeOverlappingBookingsAndAllowAdjacent(t *testing.T) {
	rules := newRules(t, timerules.DefaultConfig())
	now := time.Date(2026, time.November, 16, 0, 0, 0, 0, time.UTC)
	location := rules.Location()

	at := func(hour, minute int) time.Time {
		return time.Date(2026, time.November, 16, hour, minute, 0, 0, location)
	}

	tests := []struct {
		name   string
		busy   timerules.Interval
		starts map[time.Time]bool
	}{
		{
			name: "booking starting on the grid",
			busy: timerules.Interval{Start: at(9, 30), End: at(10, 0)},
			starts: map[time.Time]bool{
				at(9, 0):  true,
				at(9, 15): false,
				at(9, 30): false,
				at(10, 0): true,
			},
		},
		{
			name: "booking ending on the grid",
			busy: timerules.Interval{Start: at(9, 15), End: at(9, 45)},
			starts: map[time.Time]bool{
				at(9, 0):  false,
				at(9, 15): false,
				at(9, 30): false,
				at(9, 45): true,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			slots := rules.Slots(now, 30, []timerules.Interval{test.busy})

			for start, want := range test.starts {
				if got := containsStart(slots, start); got != want {
					t.Fatalf("slot %s present = %t, want %t", start.Format("15:04"), got, want)
				}
			}

			for _, slot := range slots {
				if timerules.Overlaps(slot.Start, slot.End, test.busy.Start, test.busy.End) {
					t.Fatalf("slot %s overlaps busy interval %s–%s", slot.Start, test.busy.Start, test.busy.End)
				}
			}
		})
	}
}

func TestOverlaps(t *testing.T) {
	base := time.Date(2026, time.November, 16, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name   string
		startA time.Time
		endA   time.Time
		startB time.Time
		endB   time.Time
		want   bool
	}{
		{name: "adjacent before", startA: base, endA: base.Add(30 * time.Minute), startB: base.Add(30 * time.Minute), endB: base.Add(60 * time.Minute), want: false},
		{name: "adjacent after", startA: base.Add(30 * time.Minute), endA: base.Add(60 * time.Minute), startB: base, endB: base.Add(30 * time.Minute), want: false},
		{name: "partial overlap", startA: base, endA: base.Add(60 * time.Minute), startB: base.Add(30 * time.Minute), endB: base.Add(90 * time.Minute), want: true},
		{name: "contained", startA: base.Add(10 * time.Minute), endA: base.Add(20 * time.Minute), startB: base, endB: base.Add(60 * time.Minute), want: true},
		{name: "identical", startA: base, endA: base.Add(30 * time.Minute), startB: base, endB: base.Add(30 * time.Minute), want: true},
		{name: "disjoint", startA: base, endA: base.Add(30 * time.Minute), startB: base.Add(2 * time.Hour), endB: base.Add(3 * time.Hour), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := timerules.Overlaps(test.startA, test.endA, test.startB, test.endB); got != test.want {
				t.Fatalf("overlaps = %t, want %t", got, test.want)
			}
		})
	}
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		config  timerules.Config
		wantErr bool
	}{
		{name: "default config", config: timerules.DefaultConfig()},
		{
			name: "working day shorter than max duration",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "16:59",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "working day exactly max duration",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "17:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
		},
		{
			name: "unknown timezone",
			config: timerules.Config{
				Timezone:                  "Mars/Olympus",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "18:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "malformed working hours",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "25:00",
				WorkingHoursEnd:           "18:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "working hours end before start",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "18:00",
				WorkingHoursEnd:           "09:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "zero slot step",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "18:00",
				SlotStepMinutes:           0,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "zero booking window",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "18:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         0,
				MaxMeetingDurationMinutes: 480,
			},
			wantErr: true,
		},
		{
			name: "zero max duration",
			config: timerules.Config{
				Timezone:                  "Europe/Moscow",
				WorkingHoursStart:         "09:00",
				WorkingHoursEnd:           "18:00",
				SlotStepMinutes:           15,
				BookingWindowDays:         14,
				MaxMeetingDurationMinutes: 0,
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := timerules.New(test.config)
			if test.wantErr && err == nil {
				t.Fatal("expected a configuration error, got nil")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("unexpected configuration error: %v", err)
			}
		})
	}
}
