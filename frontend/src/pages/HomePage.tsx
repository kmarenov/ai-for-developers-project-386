import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-4">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Сервис бронирования
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Календарь звонков
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          Выберите тип встречи и запишитесь на свободное время. Без регистрации, на ближайшие 14
          дней.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Каркас готов</CardTitle>
          <CardDescription>
            Бэкенд, фронтенд и проверки запускаются. Типы встреч и бронирования появятся на
            следующих шагах.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link to="/admin" className={buttonVariants({ variant: "outline" })}>
            Админка
          </Link>
          <Link to="/missing" className={buttonVariants({ variant: "ghost" })}>
            Проверить 404
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
