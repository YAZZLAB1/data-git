# UX Copy Guide — Finance OS

Voice: **calm, precise, trustworthy.** We talk like a careful accountant who is also kind:
short sentences, exact numbers, no hype, no blame. Shared strings live in `src/lib/copy.ts`.

## Glossary (use these words, everywhere)

| Use | Don't use | Notes |
|---|---|---|
| Net worth | Total balance, wealth | Assets minus liabilities. Card title: "Net worth". |
| Assets / Liabilities | Positive / negative accounts | Liabilities show the amount owed as a positive number. |
| Income / Expenses | Revenue, costs, spending money | Expenses are net of refunds. |
| Net savings | Profit, surplus | Income − expenses for the period. |
| Savings rate | Save % | "(Income − expenses) ÷ income". |
| Transfer | Move, internal payment | Never counted as income or expense. |
| Refund | Reversal, credit | Reduces the category's expenses. |
| Balance adjustment | Correction, fix | Created by "Update balance". |
| Recurring payment | Subscription (unless it is one), bill | |
| Goal / Contribution | Pot, deposit | Contributions are not expenses. |
| Projection | Forecast, prediction | Always labelled; always states the assumption. |
| Scenario | Tip, saving | "If you…, you could…". Never a promise. |

## Patterns

**Buttons** start with a verb and name the outcome: "Add transaction", "Save changes",
"Create budget", "Import 42 transactions". Never "Submit", "OK", "Yes".

**Empty states** = what this is + why it's empty + how to start.
> No transactions yet. Transactions you add or import appear here and update every report. **Add transaction**

**Errors** = what happened + why (if known) + how to fix. Never blame the user.
> Couldn't save the transaction. The date is before this account's opening date (1 Mar 2026). Choose a later date or change the opening date.

**Confirmations** name the object and the consequence; buttons repeat the action.
> **Delete "Netflix" transaction?** Balances, budgets and reports will be recalculated. This can't be undone. [Delete transaction] [Cancel]

**Toasts** are past tense, ≤ 6 words, plus the object: "Transaction added", "Budget saved", "3 transactions marked reviewed".

**Field help** explains consequences, not mechanics: "Used for net worth and reports. Each account keeps its own currency."

**Loading** — skeletons, no copy. Long operations name the step: "Checking 120 rows for duplicates…".

## Financial honesty rules

1. **Actuals vs projections.** Anything not yet recorded carries a `Projection` or `Scenario` badge and an
   "Assumes…" line (e.g. "Assumes you keep spending at this month's daily pace").
2. **No guarantees.** Use "could", "about", "at this pace". Never "you will save".
3. **Not advice.** Insights footer: *"Insights are calculated from your recorded data. They are not financial,
   tax or investment advice."*
4. **Missing data is said out loud.** "2 EUR transactions aren't included — add a EUR→MAD exchange rate."
5. **Show the math.** Every insight lists its supporting figures; the assistant explains its calculation.

## Formatting

- Currency code before the amount: `MAD 1,250.00`. Locale from Settings.
- Signs: income `+MAD 500.00` in green, expenses `−MAD 500.00` in default ink (red only for warnings/overspend).
- Dates: user's chosen format; relative ("in 3 days") only for upcoming items.
- Percentages: one decimal below 10 %, otherwise whole numbers.

## Localization notes

Avoid idioms ("in the red", "on track" is fine as a status). Leave ~30 % room for French expansion. Keep
currency codes, not symbols, because MAD has several symbol conventions (DH, د.م.).
