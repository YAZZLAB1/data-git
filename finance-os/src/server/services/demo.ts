/**
 * Optional sample data, loaded only when the user explicitly asks for it from the
 * empty dashboard. Every row goes through the regular services, so balances,
 * snapshots and reports behave exactly as with real data. Sample exchange rates
 * are marked with source "sample". Remove it all from Settings → Data.
 */
import type { Queryable } from "@/server/db";
import { addMonths, format, parseISO, startOfMonth, subMonths, getDaysInMonth } from "date-fns";
import { centsToDecimal } from "@/lib/finance/money";
import { transactionSchema, type TransactionInput } from "@/lib/validation";
import { createAccount, rebuildSnapshots } from "./accounts";
import { listCategories } from "./categories";
import { createTransaction } from "./transactions";
import { saveRule } from "./rules";
import { upsertAllocation } from "./budgets";
import { saveRecurring } from "./recurring";
import { saveGoal } from "./goals";
import { loadRateTable } from "./currency";
import { audit } from "./audit";
import { UserError } from "./errors";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadDemoData(tx: Queryable, userId: string, today: string) {
  const [{ n }] = await tx.query<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE user_id=$1", [userId]);
  if (Number(n) > 0) throw new UserError("Sample data can only be loaded into an empty workspace. Delete your financial data first in Settings → Data.");

  const rand = rng(20261126);
  const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const t = parseISO(today);
  const start = startOfMonth(subMonths(t, 12));
  const startIso = format(start, "yyyy-MM-dd");

  // Sample exchange rates (monthly), clearly marked as sample data.
  for (let i = 0; i <= 12; i++) {
    const d = format(addMonths(start, i), "yyyy-MM-dd");
    for (const [base, rate] of [
      ["EUR", between(10.75, 11.05)],
      ["USD", between(9.85, 10.15)],
      ["GBP", between(12.55, 12.95)],
    ] as const) {
      await tx.query(
        "INSERT INTO exchange_rates (user_id, base_currency, quote_currency, rate, rate_date, source) VALUES ($1,$2,'MAD',$3,$4,'sample') ON CONFLICT DO NOTHING",
        [userId, base, rate.toFixed(4), d],
      );
    }
  }

  const acct = async (name: string, type: Parameters<typeof createAccount>[2]["type"], currency: string, opening: string, institution: string | null) =>
    createAccount(tx, userId, { name, type, institution, currency, openingBalance: opening, openingDate: startIso, notes: null });
  const checking = await acct("Current account", "checking", "MAD", "24000", "CIH Bank");
  const savings = await acct("Savings", "savings", "MAD", "40000", "CIH Bank");
  const cash = await acct("Cash wallet", "cash", "MAD", "1500", null);
  const card = await acct("Visa card", "credit_card", "MAD", "0", "Attijariwafa Bank");
  const wise = await acct("EUR account", "checking", "EUR", "600", "Wise");
  const loan = await acct("Car loan", "personal_loan", "MAD", "85000", "Wafasalaf");

  const cats = await listCategories(tx, userId);
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;
  const rates = await loadRateTable(tx, userId);

  await saveRule(tx, userId, null, {
    name: "Netflix is a subscription",
    matchMode: "all",
    conditions: [{ field: "merchant", operator: "contains", value: "netflix" }],
    actions: [{ type: "set_category", value: cat("Subscriptions")! }, { type: "mark_reviewed", value: "" }],
    priority: 10,
    isActive: true,
  });
  await saveRule(tx, userId, null, {
    name: "Ride hailing",
    matchMode: "any",
    conditions: [
      { field: "merchant", operator: "contains", value: "careem" },
      { field: "merchant", operator: "contains", value: "indrive" },
    ],
    actions: [{ type: "set_category", value: cat("Transportation")! }],
    priority: 20,
    isActive: true,
  });

  const ids: Record<string, string[]> = { savingsTransfers: [] };
  let cardOwed = 0;
  const add = async (i: Omit<TransactionInput, "currency"> & { currency?: TransactionInput["currency"] }) => {
    if (i.date > today) return null;
    const input = transactionSchema.parse({ currency: "MAD", categorySource: "manual", isReviewed: i.date < format(subMonths(t, 0), "yyyy-MM-01"), ...i });
    const r = await createTransaction(tx, userId, input, { rates, skipSnapshots: true, skipAudit: true });
    if (i.accountId === card && i.type === "expense") cardOwed += Math.round(Number(input.amount) * 100);
    if (i.accountId === card && i.type === "refund") cardOwed -= Math.round(Number(input.amount) * 100);
    return r.id;
  };
  const day = (monthDate: Date, d: number) => format(new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(d, getDaysInMonth(monthDate))), "yyyy-MM-dd");

  for (let mi = 0; mi <= 12; mi++) {
    const m = addMonths(start, mi);
    const isCurrent = mi === 12;
    await add({ type: "transfer", amount: "1000", date: day(m, 1), accountId: checking, toAccountId: cash, merchant: "ATM withdrawal" });
    await add({ type: "expense", amount: "5500", date: day(m, 2), accountId: checking, merchant: "Loyer Résidence Atlas", categoryId: cat("Housing & Rent") });
    await add({ type: "expense", amount: "300", date: day(m, 3), accountId: checking, merchant: "City Club", categoryId: cat("Personal care") });
    await add({ type: "expense", amount: "349", date: day(m, 5), accountId: checking, merchant: "Maroc Telecom Fibre", categoryId: cat("Utilities") });
    await add({ type: "transfer", amount: "2400", date: day(m, 6), accountId: checking, toAccountId: loan, merchant: "Car loan payment" });
    await add({ type: "expense", amount: "320", date: day(m, 6), accountId: loan, merchant: "Loan interest", categoryId: cat("Fees & Charges") });
    await add({ type: "expense", amount: "99", date: day(m, 8), accountId: card, merchant: "Netflix" });
    await add({ type: "expense", amount: String(between(420, 720)), date: day(m, 10), accountId: checking, merchant: "Lydec", categoryId: cat("Utilities") });
    await add({ type: "expense", amount: "59.99", date: day(m, 12), accountId: card, merchant: "Spotify", categoryId: cat("Subscriptions") });
    await add({ type: "expense", amount: "29", date: day(m, 20), accountId: card, merchant: "Apple iCloud", categoryId: cat("Subscriptions") });
    await add({ type: "income", amount: mi % 4 === 3 ? "20500" : "18500", date: day(m, 24), accountId: checking, merchant: "Atlas Digital SARL", description: mi % 4 === 3 ? "Salary + quarterly bonus" : "Salary", categoryId: cat("Salary") });
    if (mi % 2 === 0) await add({ type: "income", amount: String(between(400, 900)), currency: "EUR", date: day(m, 16), accountId: wise, merchant: "Upwork", categoryId: cat("Freelance") });
    const sid = await add({ type: "transfer", amount: "2000", date: day(m, 28), accountId: checking, toAccountId: savings, merchant: "Monthly savings" });
    if (sid) ids.savingsTransfers.push(sid);

    // Groceries weekly
    for (const d of [4, 11, 18, 25]) {
      const big = rand() < 0.3;
      await add({
        type: "expense",
        amount: String(big ? between(750, 1100) : between(260, 620)),
        date: day(m, d + Math.floor(rand() * 2)),
        accountId: rand() < 0.6 ? card : checking,
        merchant: pick(["Marjane", "Carrefour Market", "BIM", "Label'Vie"]),
        categoryId: cat("Groceries"),
      });
    }
    // Restaurants — busier in the current month so the pace insight has something real to report.
    const meals = isCurrent ? 9 : 4 + Math.floor(rand() * 3);
    for (let k = 0; k < meals; k++) {
      const work = rand() < 0.25;
      await add({
        type: "expense",
        amount: String(between(70, isCurrent ? 520 : 380)),
        date: day(m, 1 + Math.floor(rand() * 27)),
        accountId: rand() < 0.5 ? card : cash,
        merchant: pick(["Café Clock", "Pizza Hut", "Sushi Box", "Glovo", "Starbucks", "Le Petit Rocher", "Tacos de Lyon"]),
        categoryId: cat("Restaurants"),
        tags: work ? ["work"] : [],
      });
    }
    for (let k = 0; k < 2; k++)
      await add({ type: "expense", amount: String(between(380, 600)), date: day(m, 7 + k * 13), accountId: card, merchant: "Afriquia", categoryId: cat("Transportation") });
    for (let k = 0; k < 3 + Math.floor(rand() * 4); k++)
      await add({ type: "expense", amount: String(between(22, 68)), date: day(m, 1 + Math.floor(rand() * 27)), accountId: cash, merchant: pick(["Careem", "inDrive"]) });
    for (let k = 0; k < 1 + Math.floor(rand() * 2); k++)
      await add({ type: "expense", amount: String(between(180, 1300)), date: day(m, 1 + Math.floor(rand() * 27)), accountId: card, merchant: pick(["Zara", "Decathlon", "Jumia", "IKEA", "H&M"]), categoryId: cat("Shopping") });
    if (rand() < 0.8)
      await add({ type: "expense", amount: String(between(70, 260)), date: day(m, 9 + Math.floor(rand() * 15)), accountId: card, merchant: pick(["Megarama", "Steam", "Bowling Anfa"]), categoryId: cat("Entertainment") });
    if (rand() < 0.5)
      await add({ type: "expense", amount: String(between(60, 380)), date: day(m, 1 + Math.floor(rand() * 27)), accountId: cash, merchant: "Pharmacie Al Amal", categoryId: cat("Healthcare") });
    // Summer trip (paid in EUR from the EUR account)
    if (m.getMonth() === 6) {
      await add({ type: "expense", amount: "384", currency: "EUR", date: day(m, 9), accountId: wise, merchant: "Booking.com", categoryId: cat("Travel"), tags: ["vacation"] });
      await add({ type: "expense", amount: "126", currency: "EUR", date: day(m, 10), accountId: wise, merchant: "Ryanair", categoryId: cat("Travel"), tags: ["vacation"] });
    }
    if (mi === 9) {
      await add({ type: "expense", amount: "799", date: day(m, 14), accountId: card, merchant: "Zara", categoryId: cat("Shopping") });
      await add({ type: "refund", amount: "399", date: day(m, 19), accountId: card, merchant: "Zara", categoryId: cat("Shopping"), notes: "Returned one item" });
      await add({
        type: "expense",
        amount: "1240",
        date: day(m, 22),
        accountId: checking,
        merchant: "Marjane",
        notes: "Groceries and a kettle",
        splits: [
          { categoryId: cat("Groceries"), amount: "890" },
          { categoryId: cat("Shopping"), amount: "350" },
        ],
      });
    }
    if (m.getMonth() === 9) await add({ type: "expense", amount: "4200", date: day(m, 15), accountId: checking, merchant: "Wafa Assurance", description: "Car insurance (annual)", categoryId: cat("Insurance") });
    // Pay the card in full on the 25th
    const payDate = day(m, 25);
    if (cardOwed > 0 && payDate <= today) {
      await add({ type: "transfer", amount: centsToDecimal(cardOwed), date: payDate, accountId: checking, toAccountId: card, merchant: "Visa card payment" });
      cardOwed = 0;
    }
  }
  // A couple of recent items to review
  const recent = format(t, "yyyy-MM-dd");
  await add({ type: "expense", amount: "189", date: recent, accountId: card, merchant: "Amazon", status: "pending" });
  await add({ type: "expense", amount: "75", date: recent, accountId: cash, merchant: "Hanout Essaada" });

  for (const a of [checking, savings, cash, card, wise, loan]) await rebuildSnapshots(tx, userId, a);

  // Budgets for the last 3 months and this month
  const plan: [string, string, boolean][] = [
    ["Housing & Rent", "5500", false],
    ["Groceries", "2800", false],
    ["Restaurants", "1200", true],
    ["Transportation", "1500", false],
    ["Utilities", "1100", false],
    ["Shopping", "1200", false],
    ["Entertainment", "400", true],
    ["Subscriptions", "200", false],
    ["Personal care", "350", false],
  ];
  for (let i = 3; i >= 0; i--) {
    const month = format(startOfMonth(subMonths(t, i)), "yyyy-MM-dd");
    for (const [name, amount, rollover] of plan) {
      const id = cat(name);
      if (id) await upsertAllocation(tx, userId, { month, categoryId: id, amount, rollover });
    }
  }

  // Recurring payments
  const next = (d: number) => {
    const thisMonth = day(t, d);
    return thisMonth >= today ? thisMonth : day(addMonths(t, 1), d);
  };
  const rec = async (name: string, merchant: string, amount: string, frequency: "monthly" | "annually", nextDate: string, category: string, account: string) =>
    saveRecurring(tx, userId, null, { name, merchant, amount, currency: "MAD", frequency, nextDate, categoryId: cat(category), accountId: account, isActive: true, notes: null });
  await rec("Rent", "Loyer Résidence Atlas", "5500", "monthly", next(2), "Housing & Rent", checking);
  await rec("Gym membership", "City Club", "300", "monthly", next(3), "Personal care", checking);
  await rec("Internet", "Maroc Telecom Fibre", "349", "monthly", next(5), "Utilities", checking);
  await rec("Netflix", "Netflix", "99", "monthly", next(8), "Subscriptions", card);
  await rec("Electricity & water", "Lydec", "600", "monthly", next(10), "Utilities", checking);
  await rec("Spotify", "Spotify", "59.99", "monthly", next(12), "Subscriptions", card);
  await rec("Car insurance", "Wafa Assurance", "4200", "annually", format(new Date(t.getMonth() >= 9 ? t.getFullYear() + 1 : t.getFullYear(), 9, 15), "yyyy-MM-dd"), "Insurance", checking);

  // Goals
  const emergency = await saveGoal(tx, userId, null, {
    name: "Emergency fund",
    kind: "emergency",
    targetAmount: "60000",
    currency: "MAD",
    targetDate: format(addMonths(t, 14), "yyyy-MM-dd"),
    linkedAccountId: savings,
    description: "Six months of essential expenses.",
    isEmergencyFund: true,
  });
  const txs = await tx.query<{ id: string; date: string }>("SELECT id, date FROM transactions WHERE id = ANY($1::uuid[]) ORDER BY date", [ids.savingsTransfers]);
  for (const r of txs)
    await tx.query("INSERT INTO goal_contributions (user_id, goal_id, amount, date, note, transaction_id) VALUES ($1,$2,'2000',$3,'Monthly savings',$4)", [userId, emergency, r.date, r.id]);
  await tx.query("INSERT INTO goal_contributions (user_id, goal_id, amount, date, note) VALUES ($1,$2,'12000',$3,'Existing savings')", [userId, emergency, startIso]);
  const moto = await saveGoal(tx, userId, null, {
    name: "New motorcycle",
    kind: "motorcycle",
    targetAmount: "45000",
    currency: "MAD",
    targetDate: format(addMonths(t, 8), "yyyy-MM-dd"),
    linkedAccountId: null,
    description: "Yamaha MT-07, paid in cash.",
    isEmergencyFund: false,
  });
  for (let i = 5; i >= 1; i--)
    await tx.query("INSERT INTO goal_contributions (user_id, goal_id, amount, date) VALUES ($1,$2,'2500',$3)", [userId, moto, format(startOfMonth(subMonths(t, i)), "yyyy-MM-dd")]);
  const trip = await saveGoal(tx, userId, null, {
    name: "Lisbon trip",
    kind: "vacation",
    targetAmount: "1500",
    currency: "EUR",
    targetDate: format(addMonths(t, 6), "yyyy-MM-dd"),
    linkedAccountId: wise,
    description: null,
    isEmergencyFund: false,
  });
  await tx.query("INSERT INTO goal_contributions (user_id, goal_id, amount, date) VALUES ($1,$2,'350',$3)", [userId, trip, format(startOfMonth(subMonths(t, 2)), "yyyy-MM-dd")]);

  await audit(tx, userId, "load_sample_data", "user", userId, {});
}
