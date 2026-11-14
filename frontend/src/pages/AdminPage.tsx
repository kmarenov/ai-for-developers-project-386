import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useGetConfig, useListBookings, useListMeetingTypes } from "@/api/generated/calendar";
import type { Booking, MeetingType } from "@/api/generated/model";
import { SiteHeader } from "@/components/SiteHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayHeading, formatTimeRange, groupByDay, timezoneCaption } from "@/lib/datetime";
import { configQueryOptions } from "@/lib/queries";

const bookingsQueryOptions = {
  query: {
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  },
};

export function AdminPage() {
  const configQuery = useGetConfig(configQueryOptions);
  const bookingsQuery = useListBookings(bookingsQueryOptions);
  const meetingTypesQuery = useListMeetingTypes();

  const config = configQuery.data?.data;
  const bookings = bookingsQuery.data?.data ?? [];
  const meetingTypes = meetingTypesQuery.data?.data ?? [];
  const isLoading = configQuery.isLoading || bookingsQuery.isLoading || meetingTypesQuery.isLoading;
  const isError = configQuery.isError || bookingsQuery.isError || meetingTypesQuery.isError;
  const now = useCurrentTime();

  const retry = () => {
    void configQuery.refetch();
    void bookingsQuery.refetch();
    void meetingTypesQuery.refetch();
  };

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Предстоящие встречи</h1>
          {config !== undefined ? (
            <p className="text-muted-foreground">{timezoneCaption(config.timezone)}</p>
          ) : null}
        </header>

        <div className="mt-8" aria-live="polite">
          {isLoading ? <MeetingsLoading /> : null}
          {!isLoading && isError ? <MeetingsError onRetry={retry} /> : null}
          {!isLoading && !isError && bookings.length === 0 ? <MeetingsEmpty /> : null}
          {!isLoading && !isError && config !== undefined && bookings.length > 0 ? (
            <MeetingsList
              bookings={bookings}
              meetingTypes={meetingTypes}
              timezone={config.timezone}
              now={now}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** Keeps the «Идёт сейчас» badge and day headers in step with the polling cadence. */
function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  return now;
}

type MeetingsListProps = {
  bookings: Booking[];
  meetingTypes: MeetingType[];
  timezone: string;
  now: Date;
};

function MeetingsList({ bookings, meetingTypes, timezone, now }: MeetingsListProps) {
  const meetingTypesByID = new Map(
    meetingTypes.map((meetingType) => [meetingType.id, meetingType]),
  );
  const groups = groupByDay(bookings, timezone, (booking) => booking.start_time);

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`admin-day-${group.key}`} className="space-y-3">
          <h2 id={`admin-day-${group.key}`} className="text-lg font-semibold tracking-tight">
            {formatDayHeading(group.items[0].start_time, timezone, now)}
          </h2>

          <ul className="space-y-3">
            {group.items.map((booking) => (
              <li key={booking.id}>
                <BookingRow
                  booking={booking}
                  meetingType={meetingTypesByID.get(booking.meeting_type_id)}
                  timezone={timezone}
                  now={now}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type BookingRowProps = {
  booking: Booking;
  meetingType: MeetingType | undefined;
  timezone: string;
  now: Date;
};

function BookingRow({ booking, meetingType, timezone, now }: BookingRowProps) {
  const isOngoing =
    Date.parse(booking.start_time) <= now.getTime() && now.getTime() < Date.parse(booking.end_time);

  return (
    <article>
      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={
                    meetingType === undefined ? "font-medium text-muted-foreground" : "font-medium"
                  }
                >
                  {meetingType?.title ?? "Тип встречи недоступен"}
                </p>
                {isOngoing ? (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    Идёт сейчас
                  </span>
                ) : null}
              </div>

              {meetingType !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {meetingType.duration_minutes} минут
                </p>
              ) : null}
            </div>

            <p className="text-sm font-medium tabular-nums sm:text-base">
              {formatTimeRange(booking.start_time, booking.end_time, timezone)}
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            <span>{booking.guest_name}</span>
            {" · "}
            {meetingType !== undefined ? (
              <a
                href={`mailto:${booking.guest_email}`}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {booking.guest_email}
              </a>
            ) : (
              <span>{booking.guest_email}</span>
            )}
          </p>
        </CardContent>
      </Card>
    </article>
  );
}

function MeetingsLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Загружаем встречи…</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-24 animate-pulse rounded-xl bg-muted ring-1 ring-foreground/10"
        />
      ))}
    </div>
  );
}

function MeetingsEmpty() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Пока нет предстоящих встреч</CardTitle>
        <CardDescription>
          Здесь появятся брони гостей. Проверьте каталог типов встреч, чтобы ссылки на запись
          работали.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/meeting-types" className={buttonVariants({ variant: "outline" })}>
          Открыть каталог встреч
        </Link>
      </CardContent>
    </Card>
  );
}

function MeetingsError({ onRetry }: { onRetry: () => unknown }) {
  return (
    <Card role="alert" className="border-destructive/30">
      <CardHeader>
        <CardTitle>Не удалось загрузить встречи</CardTitle>
        <CardDescription>Проверьте подключение и попробуйте ещё раз.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => void onRetry()}>Повторить</Button>
      </CardContent>
    </Card>
  );
}
