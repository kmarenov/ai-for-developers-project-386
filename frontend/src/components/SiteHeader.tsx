import { CalendarDays } from "lucide-react";
import { Link } from "react-router";

export function SiteHeader() {
  return (
    <header className="border-b border-border/60 bg-background">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <CalendarDays className="size-5 text-brand" aria-hidden="true" />
          Календарь звонков
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link
            to="/meeting-types"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Записаться
          </Link>
          <Link
            to="/admin"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Админка
          </Link>
        </nav>
      </div>
    </header>
  );
}
