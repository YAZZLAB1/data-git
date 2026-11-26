"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV } from "./nav";
import { Logo } from "./logo";
import { Tip } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

export function Sidebar({ user, collapsed, onToggle }: { user: { fullName: string; email: string; avatarData: string | null; baseCurrency: string }; collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-out md:flex",
        collapsed ? "w-[68px]" : "w-[244px]",
      )}
    >
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        <Link href="/" className="rounded-lg focus-ring" aria-label="Finance OS home">
          <Logo collapsed={collapsed} />
        </Link>
        {!collapsed && (
          <button onClick={onToggle} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-ring" aria-label="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map((item) => {
          const active = isActive(item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors focus-ring",
                active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-sidebar-foreground/80 hover:bg-accent hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              {active && <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />}
              <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
          return collapsed ? (
            <Tip key={item.href} content={item.label} side="right">
              {link}
            </Tip>
          ) : (
            link
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        {collapsed ? (
          <button onClick={onToggle} className="mx-auto flex rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-ring" aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : (
          <Link href="/settings" className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-accent focus-ring">
            <Avatar name={user.fullName || user.email} src={user.avatarData} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{user.fullName || "Your profile"}</p>
              <p className="truncate text-xs text-muted-foreground">Base currency · {user.baseCurrency}</p>
            </div>
          </Link>
        )}
      </div>
    </aside>
  );
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand" style={{ width: size, height: size }}>
      {initials || "·"}
    </span>
  );
}
