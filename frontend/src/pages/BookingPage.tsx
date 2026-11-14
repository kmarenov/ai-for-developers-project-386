import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { useForm } from "react-hook-form";
import type { SubmitErrorHandler } from "react-hook-form";
import { Link, useParams } from "react-router";
import { z } from "zod";

import {
  useCreateBooking,
  useGetConfig,
  useListAvailableSlots,
  useListMeetingTypes,
} from "@/api/generated/calendar";
import type { Booking, ConfigResponse, MeetingType, TimeSlot } from "@/api/generated/model";
import { SiteHeader } from "@/components/SiteHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildBookingDays,
  formatBookingRange,
  formatSlotTime,
  slotDayKey,
  timezoneCaption,
} from "@/lib/datetime";

const configQueryOptions = { query: { staleTime: 5 * 60 * 1000 } };
const mutationOptions = { mutation: { retry: 0 } };

const contractEmailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const bookingFormSchema = z.object({
  guest_name: z.string().trim().min(1, "Укажите имя").max(100, "Не больше 100 символов"),
  guest_email: z
    .string()
    .trim()
    .min(1, "Укажите email")
    .max(254, "Не больше 254 символов")
    .regex(contractEmailPattern, "Введите корректный email"),
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;

type SubmissionErrorKind =
  | "slot_taken"
  | "invalid_slot"
  | "invalid_request"
  | "meeting_type_not_found"
  | "internal"
  | "unknown";

type SubmissionError = { kind: SubmissionErrorKind };

const submissionErrorTexts: Record<
  Exclude<SubmissionErrorKind, "slot_taken" | "invalid_slot" | "meeting_type_not_found">,
  { title: string; description: string }
> = {
  invalid_request: {
    title: "Проверьте данные",
    description: "Не удалось отправить форму. Проверьте имя и email.",
  },
  internal: {
    title: "Не удалось отправить запись",
    description: "Попробуйте ещё раз — данные формы сохранены.",
  },
  unknown: {
    title: "Что-то пошло не так",
    description: "Попробуйте ещё раз.",
  },
};

function mapSubmissionError(error: unknown): SubmissionError {
  const apiError = error as { status?: number; info?: { code?: string } } | undefined;
  const code = apiError?.info?.code;
  const status = apiError?.status;

  if (code === "slot_taken") {
    return { kind: "slot_taken" };
  }
  if (code === "invalid_slot") {
    return { kind: "invalid_slot" };
  }
  if (code === "invalid_request") {
    return { kind: "invalid_request" };
  }
  if (code === "meeting_type_not_found" || status === 404) {
    return { kind: "meeting_type_not_found" };
  }
  if (code === "internal_error" || status === undefined || status >= 500) {
    return { kind: "internal" };
  }

  return { kind: "unknown" };
}

export function BookingPage() {
  const { meetingTypeId = "" } = useParams();
  const configQuery = useGetConfig(configQueryOptions);
  const catalogQuery = useListMeetingTypes();
  const slotsQuery = useListAvailableSlots({ meeting_type_id: meetingTypeId });
  const bookingMutation = useCreateBooking(mutationOptions);

  const [selectedDay, setSelectedDay] = useState<string>();
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>();
  const [formVisible, setFormVisible] = useState(false);
  const [submitError, setSubmitError] = useState<SubmissionError>();
  const [createdBooking, setCreatedBooking] = useState<Booking>();

  const alertRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLElement>(null);

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: { guest_name: "", guest_email: "" },
    mode: "onTouched",
  });

  useEffect(() => {
    if (submitError !== undefined) {
      alertRef.current?.focus();
    }
  }, [submitError]);

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
  const pageUnavailable =
    submitError?.kind === "meeting_type_not_found" ||
    (slotsQuery.isError &&
      (slotsError?.info?.code === "meeting_type_not_found" || slotsError?.status === 404));

  if (pageUnavailable) {
    return (
      <BookingFrame>
        <MeetingTypeUnavailable />
      </BookingFrame>
    );
  }

  if (slotsQuery.isError) {
    return (
      <BookingFrame>
        <ScheduleError onRetry={retry} />
      </BookingFrame>
    );
  }

  if (createdBooking !== undefined) {
    return (
      <BookingFrame>
        <BookingSuccess booking={createdBooking} meetingType={meetingType} config={config} />
      </BookingFrame>
    );
  }

  const days = buildBookingDays(config.today, config.booking_window_days);
  const slotsByDay = groupSlotsByDay(slotsQuery.data?.data ?? [], config.timezone);
  const activeDay = selectedDay ?? config.today;
  const activeSlots = slotsByDay.get(activeDay) ?? [];

  const selectDay = (dayKey: string) => {
    setSelectedDay(dayKey);

    if (
      selectedSlot !== undefined &&
      slotDayKey(selectedSlot.start_time, config.timezone) !== dayKey
    ) {
      setSelectedSlot(undefined);
    }
  };

  const selectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setFormVisible(true);
    setSubmitError(undefined);
  };

  const focusSlots = () => {
    setSubmitError(undefined);
    slotsRef.current?.focus();
  };

  const onInvalid: SubmitErrorHandler<BookingFormValues> = (errors) => {
    if (errors.guest_name !== undefined) {
      form.setFocus("guest_name");
      return;
    }
    if (errors.guest_email !== undefined) {
      form.setFocus("guest_email");
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (selectedSlot === undefined) {
      return;
    }

    setSubmitError(undefined);

    try {
      const response = await bookingMutation.mutateAsync({
        data: {
          meeting_type_id: meetingTypeId,
          start_time: selectedSlot.start_time,
          guest_name: values.guest_name,
          guest_email: values.guest_email,
        },
      });

      form.reset({ guest_name: "", guest_email: "" });
      setSelectedSlot(undefined);
      setCreatedBooking(response.data);
    } catch (error) {
      const mapped = mapSubmissionError(error);
      setSubmitError(mapped);

      if (mapped.kind === "slot_taken") {
        setSelectedSlot(undefined);
        void slotsQuery.refetch();
      }
      if (mapped.kind === "invalid_slot") {
        setSelectedSlot(undefined);
        void configQuery.refetch();
        void slotsQuery.refetch();
      }
    }
  }, onInvalid);

  const isSubmitting = bookingMutation.isPending;

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
                  onClick={() => selectDay(day.key)}
                >
                  {day.label}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        ref={slotsRef}
        aria-label="Свободные слоты"
        className="mt-8 outline-none"
        aria-live="polite"
        tabIndex={-1}
      >
        {slotsQuery.isLoading ? <SlotsLoading /> : null}
        {!slotsQuery.isLoading && activeSlots.length === 0 ? <EmptyDay /> : null}
        {!slotsQuery.isLoading && activeSlots.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {activeSlots.map((slot) => {
              const isSelected = selectedSlot?.start_time === slot.start_time;

              return (
                <li key={slot.start_time}>
                  <Button
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    className="w-full"
                    aria-pressed={isSelected}
                    onClick={() => selectSlot(slot)}
                  >
                    {formatSlotTime(slot.start_time, config.timezone)}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {formVisible ? (
        <form aria-busy={isSubmitting} className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
          <h2 className="text-xl font-semibold tracking-tight">Ваши данные</h2>

          {selectedSlot !== undefined ? (
            <p className="font-medium">
              {formatBookingRange(selectedSlot.start_time, selectedSlot.end_time, config.timezone)}
            </p>
          ) : null}

          {submitError?.kind === "slot_taken" || submitError?.kind === "invalid_slot" ? (
            <SlotAlert ref={alertRef} kind={submitError.kind} onChooseAnother={focusSlots} />
          ) : null}

          {submitError !== undefined &&
          submitError.kind !== "slot_taken" &&
          submitError.kind !== "invalid_slot" &&
          submitError.kind !== "meeting_type_not_found" ? (
            <FormAlert ref={alertRef} kind={submitError.kind} />
          ) : null}

          <div className="space-y-2">
            <label htmlFor="guest-name" className="block text-sm font-medium">
              Имя
            </label>
            <input
              id="guest-name"
              type="text"
              autoComplete="name"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={form.formState.errors.guest_name !== undefined}
              aria-describedby={
                form.formState.errors.guest_name !== undefined ? "guest-name-error" : undefined
              }
              disabled={isSubmitting}
              {...form.register("guest_name")}
            />
            {form.formState.errors.guest_name?.message !== undefined ? (
              <p id="guest-name-error" className="text-sm text-destructive">
                {form.formState.errors.guest_name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="guest-email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="guest-email"
              type="email"
              autoComplete="email"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={form.formState.errors.guest_email !== undefined}
              aria-describedby={
                form.formState.errors.guest_email !== undefined ? "guest-email-error" : undefined
              }
              disabled={isSubmitting}
              {...form.register("guest_email")}
            />
            {form.formState.errors.guest_email?.message !== undefined ? (
              <p id="guest-email-error" className="text-sm text-destructive">
                {form.formState.errors.guest_email.message}
              </p>
            ) : null}
          </div>

          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={selectedSlot === undefined || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
                Отправляем…
              </>
            ) : (
              "Записаться"
            )}
          </Button>
        </form>
      ) : null}

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

function BookingSuccess({
  booking,
  meetingType,
  config,
}: {
  booking: Booking;
  meetingType: MeetingType | undefined;
  config: ConfigResponse;
}) {
  return (
    <Card role="status">
      <CardHeader>
        <h1 className="font-heading text-3xl leading-snug font-semibold tracking-tight">
          Вы записаны
        </h1>
      </CardHeader>
      <CardContent className="space-y-2">
        {meetingType !== undefined ? <p className="font-medium">{meetingType.title}</p> : null}
        <p className="text-lg">
          {formatBookingRange(booking.start_time, booking.end_time, config.timezone)}
        </p>
        <p>{booking.guest_name}</p>
        <p className="text-muted-foreground">{booking.guest_email}</p>
      </CardContent>
      <CardContent className="flex flex-wrap gap-3">
        <Link to="/meeting-types" className={buttonVariants()}>
          Записаться ещё
        </Link>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          На главную
        </Link>
      </CardContent>
    </Card>
  );
}

const SlotAlert = ({
  ref,
  kind,
  onChooseAnother,
}: {
  ref: Ref<HTMLDivElement>;
  kind: "slot_taken" | "invalid_slot";
  onChooseAnother: () => void;
}) => {
  const isTaken = kind === "slot_taken";

  return (
    <Card
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="border-amber-500/40 bg-amber-50 text-amber-950 outline-none dark:bg-amber-950/30 dark:text-amber-50"
    >
      <CardHeader>
        <CardTitle>
          {isTaken ? "Это время только что заняли" : "Это время больше недоступно"}
        </CardTitle>
        <CardDescription className="text-amber-900 dark:text-amber-100">
          {isTaken
            ? "Выберите другой слот — список уже обновлён."
            : "Расписание обновилось. Выберите другой слот."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={onChooseAnother}>
          Выбрать другое время
        </Button>
      </CardContent>
    </Card>
  );
};

const FormAlert = ({
  ref,
  kind,
}: {
  ref: Ref<HTMLDivElement>;
  kind: keyof typeof submissionErrorTexts;
}) => {
  const text = submissionErrorTexts[kind];

  return (
    <Card ref={ref} role="alert" tabIndex={-1} className="border-destructive/30 outline-none">
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
    </Card>
  );
};

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
