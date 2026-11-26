/** Shared UI copy. See docs/UX_COPY.md for voice, glossary and patterns. */
export const COPY = {
  disclaimer:
    "Insights are calculated from your recorded data. They are not financial, tax or investment advice.",
  projectionBadge: "Projection",
  scenarioBadge: "Scenario",
  actualBadge: "Actual",
  transferNote: "Transfers move money between your own accounts. They never count as income or expenses.",
  goalContributionNote: "Contributions set money aside for this goal. They are not counted as expenses.",
  empty: {
    transactions: {
      title: "No transactions yet",
      body: "Transactions you add or import appear here and update every report.",
    },
    transactionsFiltered: {
      title: "No transactions match these filters",
      body: "Try a wider date range or clear a filter.",
    },
    accounts: {
      title: "No accounts yet",
      body: "Add your cash, bank and card accounts to see your net worth and track balances.",
    },
    budgets: {
      title: "No budget for this month",
      body: "Set a monthly amount per category to see what's left as you spend.",
    },
    recurring: {
      title: "No recurring payments",
      body: "Track rent, subscriptions and bills to see what's due and your monthly commitments.",
    },
    goals: {
      title: "No goals yet",
      body: "Create a goal to see how much to set aside each month and when you'll get there.",
    },
    insights: {
      title: "Nothing to flag right now",
      body: "Insights appear as you record transactions, budgets and goals.",
    },
    chart: {
      title: "No data for this period",
      body: "Choose a wider date range or add transactions.",
    },
  },
} as const;

export function missingRateMessage(count: number, from: string, to: string) {
  return `${count} ${from} ${count === 1 ? "amount isn't" : "amounts aren't"} included — add a ${from}→${to} exchange rate in Settings.`;
}
