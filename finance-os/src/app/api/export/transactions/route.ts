import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { exportTransactionsCsv } from "@/server/services/data";
import { isISODate } from "@/lib/period";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const csv = await withUser(user.id, (tx) => exportTransactionsCsv(tx, user.id, isISODate(from) ? from : undefined, isISODate(to) ? to : undefined));
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
