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
