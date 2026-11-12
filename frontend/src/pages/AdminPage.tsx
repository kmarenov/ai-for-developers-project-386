import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AdminPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Админка</CardTitle>
          <CardDescription>
            Здесь владелец календаря будет создавать типы встреч и смотреть расписание.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
