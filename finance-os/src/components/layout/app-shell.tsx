"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LogOut, Menu, Moon, Plus, Search, Settings, Sun, User } from "lucide-react";
import { Sidebar, Avatar } from "./sidebar";
import { NAV, titleFor, hasPeriodFilter } from "./nav";
import { PeriodFilter } from "./period-filter";
import { QuickAddProvider, useQuickAdd } from "./quick-add";
import { CommandPalette } from "./command-palette";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, TooltipProvider } from "@/components/ui/menu";
import { ConfirmProvider } from "@/components/ui/confirm";
import { PrefsProvider, type Prefs } from "@/components/common/prefs";
import { logoutAction } from "@/server/actions/auth";
import { setThemeAction } from "@/server/actions/data";
import type { AccountOption, CategoryOption, TagOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Notification {
  id: string;
  title: string;
  body: string;
  href: string;
  tone: "warning" | "negative" | "info";
}

interface ShellProps {
  user: { fullName: string; email: string; avatarData: string | null; baseCurrency: string; theme: "light" | "dark" | "system" };
  prefs: Prefs;
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
  notifications: Notification[];
  children: React.ReactNode;
}

export function AppShell(props: ShellProps) {
  return (
    <PrefsProvider value={props.prefs}>
      <TooltipProvider>
        <ConfirmProvider>
          <QuickAddProvider accounts={props.accounts} categories={props.categories} tags={props.tags}>
            <Shell {...props} />
          </QuickAddProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </PrefsProvider>
  );
}

function Shell({ user, notifications, children }: ShellProps) {
  const pathname = usePathname();
  const quick = useQuickAdd();
  const [collapsed, setCollapsed] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("fos.sidebar") === "collapsed");
    } catch {}
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !document.querySelector("[role=dialog]"))) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("fos.sidebar", c ? "expanded" : "collapsed");
      } catch {}
      return !c;
    });
  };
  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    void setThemeAction(next ? "dark" : "light");
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} collapsed={collapsed} onToggle={toggleCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
          <MobileNav />
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{titleFor(pathname)}</h1>
          <div className="ml-auto flex items-center gap-1.5">
            {hasPeriodFilter(pathname) && (
              <React.Suspense>
                <PeriodFilter />
              </React.Suspense>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden h-8 items-center gap-2 rounded-lg border border-input bg-card px-2.5 text-[13px] text-muted-foreground shadow-sm hover:bg-accent focus-ring lg:flex"
            >
              <Search className="h-3.5 w-3.5" /> Search
              <kbd className="rounded border bg-muted px-1 text-[10px]">⌘K</kbd>
            </button>
            <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <Search />
            </Button>
            <Notifications items={notifications} />
            <Button size="sm" onClick={() => quick.open()} className="gap-1.5">
              <Plus /> <span className="hidden sm:inline">Add transaction</span>
              <kbd className="ml-0.5 hidden rounded bg-primary-foreground/15 px-1 text-[10px] sm:inline">N</kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-1 rounded-full focus-ring" aria-label="Profile menu">
                <Avatar name={user.fullName || user.email} src={user.avatarData} size={30} />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>
                  <span className="block truncate text-sm font-medium text-foreground">{user.fullName || "Your profile"}</span>
                  <span className="block truncate">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <User /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings?tab=preferences">
                    <Settings /> Preferences
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {dark ? <Sun /> : <Moon />} {dark ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logoutAction()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main key={pathname} className="page-enter mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onToggleTheme={toggleTheme} />
    </div>
  );
}

function MobileNav() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-md p-1.5 hover:bg-accent focus-ring md:hidden" aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {NAV.map((n) => (
          <DropdownMenuItem key={n.href} asChild>
            <Link href={n.href}>
              <n.icon /> {n.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Notifications({ items }: { items: Notification[] }) {
  const [seen, setSeen] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem("fos.seen") ?? "[]"));
    } catch {}
  }, []);
  const unseen = items.filter((i) => !seen.includes(i.id)).length;
  const markSeen = () => {
    const ids = items.map((i) => i.id);
    setSeen(ids);
    try {
      localStorage.setItem("fos.seen", JSON.stringify(ids));
    } catch {}
  };
  return (
    <Popover onOpenChange={(o) => !o && markSeen()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Notifications${unseen ? ` (${unseen} new)` : ""}`} className="relative">
          <Bell />
          {unseen > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-negative ring-2 ring-background" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <p className="text-xs text-muted-foreground">Upcoming payments and budget alerts from your data.</p>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <ul className="max-h-[360px] divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.href} className="flex gap-3 px-4 py-3 hover:bg-accent">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", { warning: "bg-warning", negative: "bg-negative", info: "bg-info" }[n.tone])} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block text-xs text-muted-foreground">{n.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
