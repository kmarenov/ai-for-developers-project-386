import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { SiteHeader } from "@/components/SiteHeader";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  "Выбор типа встречи и удобного времени",
  "Быстрое бронирование с подтверждением и заметками гостя",
  "Управление типами встреч и просмотр предстоящих записей в админке",
];

export function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="flex-1 bg-[radial-gradient(70rem_40rem_at_10%_-10%,#dbe7ff_0%,transparent_60%),radial-gradient(60rem_40rem_at_100%_0%,#ffe8d6_0%,transparent_55%)]">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
          <div className="space-y-6">
            <p className="inline-flex items-center rounded-full bg-white/80 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase ring-1 ring-black/5">
              Быстрая запись на звонок
            </p>

            <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Календарь звонков
            </h1>

            <p className="max-w-md text-lg text-muted-foreground">
              Забронируйте встречу за минуту: выберите тип встречи и удобное время.
            </p>

            <Link
              to="/meeting-types"
              className={buttonVariants({
                variant: "brand",
                className: "h-11 gap-2 px-6 text-base",
              })}
            >
              Записаться
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <Card className="rounded-2xl border-white/60 bg-white/90">
            <CardHeader>
              <CardTitle className="text-xl">Возможности</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-3 pl-4 text-muted-foreground marker:text-foreground/30">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
