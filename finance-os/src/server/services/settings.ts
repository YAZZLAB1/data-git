import type { Queryable } from "@/server/db";
import { audit } from "./audit";

export async function updateProfile(tx: Queryable, userId: string, d: { fullName: string; avatarData?: string | null }) {
  await tx.query("UPDATE profiles SET full_name=$1, avatar_data=$2 WHERE user_id=$3", [d.fullName, d.avatarData ?? null, userId]);
  await audit(tx, userId, "update", "profile", userId, { fullName: d.fullName, avatar: !!d.avatarData });
}

export async function updatePreferences(
  tx: Queryable,
  userId: string,
  d: { baseCurrency: string; dateFormat: string; numberLocale: string; theme: string; timezone: string; budgetRolloverDefault: boolean; emergencyFundMonths: number },
) {
  await tx.query(
    `UPDATE profiles SET base_currency=$1, date_format=$2, number_locale=$3, theme=$4, timezone=$5, budget_rollover_default=$6, emergency_fund_months=$7
      WHERE user_id=$8`,
    [d.baseCurrency, d.dateFormat, d.numberLocale, d.theme, d.timezone, d.budgetRolloverDefault, d.emergencyFundMonths, userId],
  );
  await audit(tx, userId, "update", "preferences", userId, d);
}
