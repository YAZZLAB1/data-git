import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { exportAccountsCsv } from "@/server/services/data";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const csv = await withUser(user.id, (tx) => exportAccountsCsv(tx, user.id));
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
