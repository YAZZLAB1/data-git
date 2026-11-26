"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Bot, CalendarClock, Check, ChevronDown, Database, Lightbulb, PiggyBank, Receipt, Repeat, RotateCcw, Send, Target, TrendingUp, Wallet, X } from "lucide-react";
import type { StoredInsight, InsightType } from "@/server/services/insights";
import type { AssistantAnswer } from "@/server/services/assistant";
import { askAssistantAction, setInsightStatusAction } from "@/server/actions/finance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { useFmt } from "@/components/common/prefs";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

const TYPE_META: Record<InsightType, { label: string; icon: React.ElementType }> = {
  spending: { label: "Spending", icon: Receipt },
  budget: { label: "Budget", icon: Wallet },
  savings: { label: "Savings", icon: PiggyBank },
  recurring: { label: "Recurring payments", icon: Repeat },
  cash_flow: { label: "Cash flow", icon: TrendingUp },
  goals: { label: "Financial goals", icon: Target },
  data_quality: { label: "Data", icon: Database },
};
const PRIORITY_TONE = { high: "negative", medium: "warning", low: "neutral" } as const;

export function InsightsView({ insights, suggestions }: { insights: StoredInsight[]; suggestions: string[] }) {
  const [filter, setFilter] = React.useState<string>("all");
  const [showHistory, setShowHistory] = React.useState(false);
  const active = insights.filter((i) => i.status === "active");
  const history = insights.filter((i) => i.status !== "active");
  const types = [...new Set(active.map((i) => i.type))];
  const shown = active.filter((i) => filter === "all" || i.type === filter);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All ({active.length})</TabsTrigger>
              {types.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TYPE_META[t].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Badge tone="positive">Actual</Badge> recorded data</span>
            <span className="flex items-center gap-1"><Badge tone="info">Projection</Badge> estimate</span>
            <span className="flex items-center gap-1"><Badge tone="brand">Scenario</Badge> what-if</span>
          </div>
        </div>
        {shown.length === 0 ? (
          <Card>
            <EmptyState icon={<Lightbulb />} title={COPY.empty.insights.title} body={COPY.empty.insights.body} />
          </Card>
        ) : (
          <div className="space-y-3">
            {shown.map((i) => (
              <InsightCard key={i.id} i={i} />
            ))}
          </div>
        )}
        {history.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)}>
              <ChevronDown className={cn("transition-transform", showHistory && "rotate-180")} /> {showHistory ? "Hide" : "Show"} {history.length} dismissed or completed
            </Button>
            {showHistory && (
              <div className="mt-2 space-y-3 opacity-80">
                {history.map((i) => (
                  <InsightCard key={i.id} i={i} />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{COPY.disclaimer}</p>
      </div>
      <Assistant suggestions={suggestions} />
    </div>
  );
}

function InsightCard({ i }: { i: StoredInsight }) {
  const f = useFmt();
  const meta = TYPE_META[i.type];
  const [busy, setBusy] = React.useState(false);
  const set = async (status: "active" | "dismissed" | "completed") => {
    setBusy(true);
    const r = await setInsightStatusAction(i.id, status);
    setBusy(false);
    if (r.ok) toast.success(status === "dismissed" ? "Insight dismissed" : status === "completed" ? "Marked as done" : "Insight restored");
    else toast.error(r.error);
  };
  return (
    <Card className="card-hover p-5 animate-fade-up">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", i.priority === "high" ? "bg-negative-soft text-negative" : i.priority === "medium" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
          <meta.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={PRIORITY_TONE[i.priority]}>{i.priority[0].toUpperCase() + i.priority.slice(1)} priority</Badge>
            <Badge tone={i.basis === "actual" ? "positive" : i.basis === "projection" ? "info" : "brand"}>{i.basis === "actual" ? COPY.actualBadge : i.basis === "projection" ? COPY.projectionBadge : COPY.scenarioBadge}</Badge>
            <span className="text-xs text-muted-foreground">
              {meta.label} · {f.date(i.generated_at.slice(0, 10))}
            </span>
            {i.status !== "active" && <Badge tone="outline">{i.status === "dismissed" ? "Dismissed" : "Done"}</Badge>}
          </div>
          <h3 className="mt-2 font-semibold leading-snug">{i.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{i.body}</p>
          {i.figures.length > 0 && (
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              {i.figures.map((x) => (
                <div key={x.label} className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="truncate text-xs text-muted-foreground">{x.label}</dt>
                  <dd className="num mt-0.5 truncate text-sm font-semibold">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {i.assumptions && <p className="mt-2 text-xs italic text-muted-foreground">{i.assumptions}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {i.action && (
              <Button asChild size="sm" variant="outline">
                <Link href={i.action.href}>
                  {i.action.label} <ArrowRight />
                </Link>
              </Button>
            )}
            {i.status === "active" ? (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("completed")}>
                  <Check /> Mark done
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("dismissed")}>
                  <X /> Dismiss
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("active")}>
                <RotateCcw /> Restore
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Assistant({ suggestions }: { suggestions: string[] }) {
  const [q, setQ] = React.useState("");
  const [log, setLog] = React.useState<{ q: string; a: AssistantAnswer | null; error?: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setLog((l) => [...l, { q: question, a: null }]);
    const r = await askAssistantAction(question);
    setBusy(false);
    setLog((l) => l.map((x, i) => (i === l.length - 1 ? { q: question, a: r.ok ? r.data : null, error: r.ok ? undefined : r.error } : x)));
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };
  return (
    <Card className="flex h-fit flex-col xl:sticky xl:top-20 xl:max-h-[calc(100vh-7rem)]">
      <CardHeader className="border-b pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-brand" /> Ask about your money
          </CardTitle>
          <CardDescription>Answers come from your recorded data through read-only calculations, with the math shown.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 overflow-y-auto pt-4">
        {log.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        )}
        {log.map((x, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-8 rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{x.q}</p>
            {x.a === null && !x.error ? (
              <p className="mr-8 rounded-xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">Calculating…</p>
            ) : x.error ? (
              <p className="mr-8 rounded-xl rounded-bl-sm bg-negative-soft px-3 py-2 text-sm text-negative">{x.error}</p>
            ) : (
              <div className="mr-4 space-y-2 rounded-xl rounded-bl-sm border bg-card px-3 py-2.5 text-sm">
                <p>{x.a!.answer}</p>
                {x.a!.calculation.length > 0 && (
                  <details className="group text-xs text-muted-foreground" open={i === log.length - 1}>
                    <summary className="cursor-pointer select-none font-medium text-foreground/80">How this was calculated</summary>
                    <ul className="mt-1.5 space-y-1 border-l-2 pl-3">
                      {x.a!.calculation.map((c, j) => (
                        <li key={j} className="num">{c}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {x.a!.links && (
                  <div className="flex flex-wrap gap-1">
                    {x.a!.links.map((l) => (
                      <Button key={l.href} asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                        <Link href={l.href}>
                          {l.label} <ArrowRight />
                        </Link>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {log.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.slice(0, 4).map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </CardContent>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How much did I spend on groceries last month?" aria-label="Ask a question" maxLength={300} />
        <Button type="submit" size="icon" aria-label="Ask" loading={busy}>
          {!busy && <Send />}
        </Button>
      </form>
      <p className="flex items-center gap-1.5 px-4 pb-3 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3 w-3" /> Rule-based assistant. An AI model can be connected later through the same read-only functions.
      </p>
    </Card>
  );
}
