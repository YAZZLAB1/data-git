"use client";
import * as React from "react";
import { Table2, ChartColumn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

export interface TableView {
  headers: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  description,
  actions,
  empty,
  table,
  children,
  className,
  footer,
  height = 280,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  empty?: boolean;
  table?: TableView;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  height?: number | "auto";
}) {
  const [showTable, setShowTable] = React.useState(false);
  return (
    <Card className={cn("card-hover flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {table && !empty && (
            <Tip content={showTable ? "Show chart" : "Show as table"}>
              <Button variant="ghost" size="icon-sm" onClick={() => setShowTable((s) => !s)} aria-label={showTable ? "Show chart" : "Show as table"}>
                {showTable ? <ChartColumn /> : <Table2 />}
              </Button>
            </Tip>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {empty ? (
          <div style={{ minHeight: height === "auto" ? 220 : height }} className="flex items-center justify-center">
            <EmptyState icon={<ChartColumn />} title={COPY.empty.chart.title} body={COPY.empty.chart.body} />
          </div>
        ) : showTable && table ? (
          <div className="overflow-auto rounded-lg border" style={{ maxHeight: height === "auto" ? 360 : height + 40 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={h} className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={cn("px-3 py-1.5", j > 0 && "num text-right")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={height === "auto" ? undefined : { height }} className="animate-fade-up">
            {children}
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];
  label?: string;
  format: (v: number, key?: string) => string;
  labelFormat?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-card-hover">
      {label !== undefined && <p className="mb-1.5 font-medium text-foreground">{labelFormat ? labelFormat(String(label)) : label}</p>}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="num font-medium text-foreground">{format(Number(p.value ?? 0), String(p.dataKey))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn("h-0.5 w-3 rounded", i.dashed && "border-t-2 border-dashed bg-transparent")} style={i.dashed ? { borderColor: i.color } : { background: i.color, height: 8, width: 8, borderRadius: 999 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
