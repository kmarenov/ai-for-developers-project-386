import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-start justify-center gap-4 px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Страница не найдена</h1>
      <Link to="/" className={buttonVariants()}>
        На главную
      </Link>
    </main>
  );
}
