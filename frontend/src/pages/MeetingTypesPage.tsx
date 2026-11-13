import { Link } from "react-router";

import { SiteHeader } from "@/components/SiteHeader";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MeetingTypesPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Типы встреч</CardTitle>
            <CardDescription>
              Здесь появятся доступные типы встреч с выбором даты и времени.
            </CardDescription>
          </CardHeader>
        </Card>

        <Link
          to="/"
          className={buttonVariants({ variant: "outline", className: "mt-6 self-start" })}
        >
          На главную
        </Link>
      </main>
    </div>
  );
}
