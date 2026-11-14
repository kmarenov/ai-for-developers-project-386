import { TZDate } from "@date-fns/tz";
import { addDays, format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

export type BookingDay = {
  key: string;
  label: string;
};

/** Builds the calendar dates of the booking window from the owner's today. */
export function buildBookingDays(today: string, count: number): BookingDay[] {
  const start = parseISO(today);

  return Array.from({ length: count }, (_, index) => {
    const date = addDays(start, index);

    return {
      key: format(date, "yyyy-MM-dd"),
      label: format(date, "EEEEEE, d MMMM", { locale: ru }),
    };
  });
}

/** Returns the owner-timezone calendar date of a UTC instant as YYYY-MM-DD. */
export function slotDayKey(startTime: string, timezone: string): string {
  return format(new TZDate(startTime, timezone), "yyyy-MM-dd");
}

/** Formats a UTC instant as HH:MM in the owner timezone. */
export function formatSlotTime(startTime: string, timezone: string): string {
  return format(new TZDate(startTime, timezone), "HH:mm");
}

export function timezoneCaption(timezone: string): string {
  if (timezone === "Europe/Moscow") {
    return "Время указано по Москве (МСК).";
  }

  return `Время указано по ${timezone}.`;
}

/** Short owner timezone label: Europe/Moscow → МСК, anything else stays IANA. */
export function timezoneAbbreviation(timezone: string): string {
  if (timezone === "Europe/Moscow") {
    return "МСК";
  }

  return timezone;
}

/** Formats an owner-list day header: «Сегодня, пн, 10 ноября», «Завтра, вт, 11 ноября», «ср, 12 ноября». */
export function formatDayHeading(startTime: string, timezone: string, now: Date): string {
  const start = new TZDate(startTime, timezone);
  const today = new TZDate(now, timezone);
  const tomorrow = addDays(today, 1);
  const label = format(start, "EEEEEE, d MMMM", { locale: ru });
  const dayKey = format(start, "yyyy-MM-dd");

  if (dayKey === format(today, "yyyy-MM-dd")) {
    return `Сегодня, ${label}`;
  }
  if (dayKey === format(tomorrow, "yyyy-MM-dd")) {
    return `Завтра, ${label}`;
  }

  return label;
}

/** Formats an interval as «09:00–09:30» in the owner timezone. */
export function formatTimeRange(startTime: string, endTime: string, timezone: string): string {
  return `${formatSlotTime(startTime, timezone)}–${formatSlotTime(endTime, timezone)}`;
}

/** Formats a booking interval as «10 ноября, 09:00–09:30 (МСК)». */
export function formatBookingRange(startTime: string, endTime: string, timezone: string): string {
  const start = new TZDate(startTime, timezone);
  const end = new TZDate(endTime, timezone);

  return `${format(start, "d MMMM", { locale: ru })}, ${format(start, "HH:mm")}–${format(
    end,
    "HH:mm",
  )} (${timezoneAbbreviation(timezone)})`;
}
