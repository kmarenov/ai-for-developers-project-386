import { Link } from "react-router";

import { useListMeetingTypes } from "@/api/generated/calendar";
import type { MeetingType } from "@/api/generated/model";
import { SiteHeader } from "@/components/SiteHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MeetingTypesPage() {
  const { data, isLoading, isError, refetch } = useListMeetingTypes();
  const meetingTypes = data?.data ?? [];

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Типы встреч</h1>
          <p className="text-muted-foreground">
            Выберите повод для звонка — на следующем шаге покажем свободное время.
          </p>
        </header>

        <div className="mt-8" aria-live="polite">
          {isLoading ? <MeetingTypesLoading /> : null}
          {!isLoading && isError ? <MeetingTypesError onRetry={refetch} /> : null}
          {!isLoading && !isError && meetingTypes.length === 0 ? <MeetingTypesEmpty /> : null}
          {!isLoading && !isError && meetingTypes.length > 0 ? (
            <MeetingTypesList meetingTypes={meetingTypes} />
          ) : null}
        </div>

        <Link
          to="/"
          className={buttonVariants({ variant: "outline", className: "mt-8 self-start" })}
        >
          На главную
        </Link>
      </main>
    </div>
  );
}

type MeetingTypesListProps = {
  meetingTypes: MeetingType[];
};

function MeetingTypesList({ meetingTypes }: MeetingTypesListProps) {
  return (
    <ul className="space-y-4">
      {meetingTypes.map((meetingType) => (
        <li key={meetingType.id}>
          <Link to={`/meeting-types/${meetingType.id}`} className="block">
            <article aria-labelledby={`meeting-type-${meetingType.id}`}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle id={`meeting-type-${meetingType.id}`}>{meetingType.title}</CardTitle>
                  {meetingType.description !== "" ? (
                    <CardDescription>{meetingType.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{meetingType.duration_minutes} минут</p>
                </CardContent>
              </Card>
            </article>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MeetingTypesLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Загружаем типы встреч…</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-28 animate-pulse rounded-xl bg-muted ring-1 ring-foreground/10"
        />
      ))}
    </div>
  );
}

function MeetingTypesError({ onRetry }: { onRetry: () => unknown }) {
  return (
    <Card role="alert" className="border-destructive/30">
      <CardHeader>
        <CardTitle>Не удалось загрузить типы встреч</CardTitle>
        <CardDescription>Проверьте подключение и попробуйте ещё раз.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => void onRetry()}>Повторить</Button>
      </CardContent>
    </Card>
  );
}

function MeetingTypesEmpty() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Пока нет доступных типов встреч</CardTitle>
        <CardDescription>
          Владелец календаря ещё не опубликовал ни одного типа встречи.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
