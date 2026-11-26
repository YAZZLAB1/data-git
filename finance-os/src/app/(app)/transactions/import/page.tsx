import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { listImports } from "@/server/services/imports";
import { ImportWizard } from "@/components/transactions/import-wizard";

export const metadata = { title: "Import transactions" };

export default async function ImportPage() {
  const user = await requireUser();
  const history = await withUser(user.id, (tx) => listImports(tx, user.id));
  return <ImportWizard history={history} />;
}
