# Finance OS

A personal finance command center: accounts, transactions, budgets, recurring payments, savings goals,
interactive analytics and rule-based insights, all fed by one ledger. A transaction you record once
updates balances, budgets, charts, cash flow and insights automatically.

Built with **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Radix/shadcn-style UI ·
Recharts · date-fns · React Hook Form + Zod · PostgreSQL**.

## Run it

```bash
cd finance-os
npm install
npm run dev          # http://localhost:3000
```

No configuration is required. Without `DATABASE_URL`, the app uses **PGlite** (real PostgreSQL compiled to
WebAssembly) persisted in `./.data/pglite`, so data survives refreshes and restarts. Migrations run
automatically on first use (or with `npm run db:migrate`).

Create an account at `/register`. You can start empty or load a year of clearly labelled sample data from
the welcome screen (remove it in Settings → Data).

### Use an external PostgreSQL / Supabase database

```bash
cp .env.example .env.local
# DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Any PostgreSQL 15+ server works, including a Supabase project's database. The connecting role needs to own
the schema (e.g. Supabase's `postgres` role); migrations create a least-privileged `finance_app` role used
for every user request.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm test` | Unit + integration tests (in-memory PGlite) |
| `TEST_DATABASE_URL=… npx vitest run --no-file-parallelism` | Same suite against a real PostgreSQL server |
| `npm run typecheck` | TypeScript |
| `npm run db:migrate` | Apply SQL migrations |

## Architecture

```
db/migrations/          SQL schema (0001) and row-level security (0002)
src/lib/finance/        Pure, tested financial logic: money (integer cents), ledger conventions,
                        calculations, currency conversion, rule engine
src/server/db/          Driver (pg or PGlite), migrations, withUser() = RLS-scoped transaction
src/server/auth/        scrypt password hashing, DB-backed sessions (httpOnly cookies), rate limiting
src/server/services/    Business logic: accounts, transactions, rules, budgets, recurring, goals,
                        reporting, insights, assistant, imports, data (export/backup/restore), demo
src/server/actions/     Server actions: Zod validation → service → revalidate all views
src/server/queries/     Page data assembly (overview, analytics, shell)
src/components/         UI primitives, layout shell, charts, feature views
docs/UX_COPY.md         Voice, glossary and copy patterns
```

Business logic never lives in components: every number on screen comes from `src/lib/finance` via the
services.

## Accounting conventions

| Type | Effect on account | Reporting |
| --- | --- | --- |
| Income | + | Income |
| Expense | − (owed + for cards/loans) | Expense |
| Refund | + | Reduces that category's expenses (never income) |
| Transfer | − from, + to | Excluded. Card and loan payments are transfers, so purchases aren't double-counted |
| Adjustment | ± | Excluded. Created by "Update balance" so balances stay explainable |

- Amounts are `NUMERIC(14,2)` in the database and integer cents in memory: no floats.
- Balances = opening balance + ledger. End-of-day **balance snapshots** (`account_balances`) are rebuilt
  whenever an account's transactions change; net-worth history reads snapshots and is never projected
  backward from today's balance.
- Splits must add up to the transaction amount; category reports use splits when present.
- Pending and posted are one record with a status, so nothing is counted twice; CSV import flags likely
  duplicates (same account, amount and direction, ±2 days, similar merchant).
- Archived accounts stay in history and net worth. Accounts with transactions can't be deleted.
- **Currencies:** each account and transaction keeps its currency. Reports convert to the base currency
  with stored rates (latest on/before the date, inverse or cross rates allowed). Missing rates exclude the
  amount and show a warning; amounts are never added across currencies directly.

Formulas (all in `src/lib/finance/calculations.ts`): Net worth = assets − liabilities · Savings rate =
(income − expenses) ÷ income · Budget remaining = budget − spending + eligible rollover · Goal progress =
saved ÷ target · Required monthly = (target − saved) ÷ months remaining.

## Security

- Every user request runs in a transaction with `SET LOCAL ROLE finance_app` and `app.user_id`; PostgreSQL
  row-level security policies on every table restrict reads and writes to the user's own rows, and views
  use `security_invoker`. Services also filter by `user_id` (defence in depth). Tests verify another
  user's data is invisible and unwritable.
- scrypt password hashes, hashed session tokens, httpOnly/SameSite cookies (Secure in production), login
  rate limiting, session list and revocation, sign-out-everywhere on password change.
- Server-side Zod validation on every action, audit log of financial changes, CSV formula-injection
  protection on export, security headers. No bank credentials are stored; no secrets reach the browser.

## Insights & assistant

Insights are deterministic rules over recorded data (category pace, budget warnings, recurring
commitments, month-over-month changes, savings rate, discretionary scenario, cash-flow projection, goal
contributions, emergency coverage, data quality). Each states its figures and is labelled **Actual**,
**Projection** or **Scenario** with its assumption. Users can dismiss or complete them.

The assistant (`src/server/services/assistant.ts`) answers common questions through controlled read-only
functions (`assistantTools`) and shows its calculation. An LLM provider can implement `AssistantProvider`
and call the same functions; it never gets raw database access.

## Not included yet

- Live bank connections (the schema reserves `external_provider`/`external_id`; no credentials stored).
- Automatic exchange-rate retrieval (rates are entered manually).
- Two-factor authentication and additional UI languages.
