export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <rect width="32" height="32" rx="9" className="fill-foreground" />
        <path d="M9 21.5 14 16l3.5 3.5L23 12" fill="none" stroke="hsl(var(--brand))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-[hsl(var(--brand))]" />
        <circle cx="23" cy="12" r="2" className="fill-background" />
      </svg>
      {!collapsed && (
        <span className="text-[15px] font-semibold tracking-tight">
          Finance<span className="text-muted-foreground font-medium"> OS</span>
        </span>
      )}
    </div>
  );
}
