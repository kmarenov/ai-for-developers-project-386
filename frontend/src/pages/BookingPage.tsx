import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import { useGetConfig, useListAvailableSlots, useListMeetingTypes } from "@/api/generated/calendar";
import type { TimeSlot } from "@/api/generated/model";
import { SiteHeader } from "@/components/SiteHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildBookingDays, formatSlotTime, slotDayKey, timezoneCaption } from "@/lib/datetime";

const configQueryOptions = { query: { staleTime: 5 * 60 * 1000 } };

export function BookingPage() {
  const { meetingTypeId = "" } = useParams();
  const configQuery = useGetConfig(configQueryOptions);
  const catalogQuery = useListMeetingTypes();
  const slotsQuery = useListAvailableSlots({ meeting_type_id: meetingTypeId });

  const [selectedDay, setSelectedDay] = useState<string>();

  const config = configQuery.data?.data;
  const meetingType = catalogQuery.data?.data.find((item) => item.id === meetingTypeId);

  const retry = () => {
    void configQuery.refetch();
    void slotsQuery.refetch();
  };

  if (configQuery.isLoading) {
    return (
      <BookingFrame>
        <SlotsLoading />
      </BookingFrame>
    );
  }

  if (configQuery.isError || !config) {
    return (
      <BookingFrame>
        <ScheduleError onRetry={retry} />
      </BookingFrame>
    );
  }

  const slotsError = slotsQuery.error;
  if (slotsQuery.isError) {
    if (slotsError?.info?.code === "meeting_type_not_found" || slotsError?.status === 404) {
      return (
        <BookingFrame>
          <MeetingTypeUnavailable />
        </BookingFrame>
      );
    }

    return (
      <BookingFrame>
        <ScheduleError onRetry={retry} />
      </BookingFrame>
    );
  }

  const days = buildBookingDays(config.today, config.booking_window_days);
  const slotsByDay = groupSlotsByDay(slotsQuery.data?.data ?? [], config.timezone);
  const activeDay = selectedDay ?? config.today;
  const activeSlots = slotsByDay.get(activeDay) ?? [];

  return (
    <BookingFrame>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {meetingType?.title ?? "Запись на встречу"}
        </h1>
        {meetingType !== undefined ? (
          <p className="font-medium text-muted-foreground">{meetingType.duration_minutes} минут</p>
        ) : null}
        {meetingType !== undefined && meetingType.description !== "" ? (
          <p className="text-muted-foreground">{meetingType.description}</p>
        ) : null}
      </header>

      <p className="mt-8 text-sm text-muted-foreground">{timezoneCaption(config.timezone)}</p>

      <section aria-label="Календарь" className="mt-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => {
            const hasSlots = (slotsByDay.get(day.key)?.length ?? 0) > 0;
            const isActive = day.key === activeDay;

            return (
              <li key={day.key}>
                <Button
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  className="w-full"
                  aria-pressed={isActive}
                  disabled={!hasSlots}
                  onClick={() => setSelectedDay(day.key)}
                >
                  {day.label}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Свободные слоты" className="mt-8" aria-live="polite">
        {slotsQuery.isLoading ? <SlotsLoading /> : null}
        {!slotsQuery.isLoading && activeSlots.length === 0 ? <EmptyDay /> : null}
        {!slotsQuery.isLoading && activeSlots.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {activeSlots.map((slot) => (
              <li key={slot.start_time}>
                <Button type="button" variant="outline" className="w-full">
                  {formatSlotTime(slot.start_time, config.timezone)}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Link
        to="/meeting-types"
        className={buttonVariants({ variant: "ghost", className: "mt-8 self-start" })}
      >
        К каталогу встреч
      </Link>
    </BookingFrame>
  );
}

function groupSlotsByDay(slots: TimeSlot[], timezone: string) {
  const slotsByDay = new Map<string, TimeSlot[]>();

  for (const slot of slots) {
    const day = slotDayKey(slot.start_time, timezone);
    const existing = slotsByDay.get(day);

    if (existing === undefined) {
      slotsByDay.set(day, [slot]);
    } else {
      existing.push(slot);
    }
  }

  return slotsByDay;
}

function BookingFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">{children}</main>
    </div>
  );
}

function SlotsLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">Загружаем слоты…</span>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            aria-hidden="true"
            className="h-8 animate-pulse rounded-lg bg-muted ring-1 ring-foreground/10"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyDay() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>На этот день нет свободного времени</CardTitle>
        <CardDescription>Выберите другой день.</CardDescription>
      </CardHeader>
    </Card>
  );
}

function ScheduleError({ onRetry }: { onRetry: () => unknown }) {
  return (
    <Card role="alert" className="border-destructive/30">
      <CardHeader>
        <CardTitle>Не удалось загрузить расписание</CardTitle>
        <CardDescription>Проверьте подключение и попробуйте ещё раз.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => void onRetry()}>Повторить</Button>
      </CardContent>
    </Card>
  );
}

function MeetingTypeUnavailable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Тип встречи недоступен</CardTitle>
        <CardDescription>
          Возможно, ссылка устарела. Выберите другой тип встречи в каталоге.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/meeting-types" className={buttonVariants({ variant: "outline" })}>
          К каталогу встреч
        </Link>
      </CardContent>
    </Card>
  );
}
