import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { buildBackup } from "@/server/services/data";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const backup = await withUser(user.id, (tx) => buildBackup(tx, user.id));
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-os-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
