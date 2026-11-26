-- Finance OS core schema.
-- Conventions:
--   * UUID primary keys, created_at / updated_at timestamps on every table.
--   * Monetary values are NUMERIC(14,2); exchange rates NUMERIC(18,8). Never floats.
--   * Every financial row carries user_id and is protected by row-level security (0002).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name      text NOT NULL DEFAULT '',
  avatar_data    text,
  base_currency  char(3) NOT NULL DEFAULT 'MAD' CHECK (base_currency IN ('MAD','EUR','USD','GBP')),
  date_format    text NOT NULL DEFAULT 'dd MMM yyyy',
  number_locale  text NOT NULL DEFAULT 'en-US',
  language       text NOT NULL DEFAULT 'en',
  theme          text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  timezone       text NOT NULL DEFAULT 'UTC',
  budget_rollover_default boolean NOT NULL DEFAULT false,
  emergency_fund_months   integer NOT NULL DEFAULT 6 CHECK (emergency_fund_months BETWEEN 1 AND 24),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- accounts
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  type            text NOT NULL CHECK (type IN ('cash','checking','savings','investment','other_asset',
                                                 'credit_card','personal_loan','mortgage','other_liability')),
  institution     text,
  currency        char(3) NOT NULL CHECK (currency IN ('MAD','EUR','USD','GBP')),
  -- Balance at the start of opening_date. For liabilities this is the amount owed (positive).
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date    date NOT NULL DEFAULT CURRENT_DATE,
  notes           text,
  is_archived     boolean NOT NULL DEFAULT false,
  -- Reserved for future bank-API integrations. No credentials are ever stored.
  external_provider text,
  external_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_idx ON accounts (user_id);

-- Recorded end-of-day balance snapshots. Maintained from the ledger whenever an
-- account's transactions change; used for historical balance / net-worth charts.
CREATE TABLE account_balances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        date NOT NULL,
  balance     numeric(14,2) NOT NULL,          -- natural sign: owed amount for liabilities
  source      text NOT NULL DEFAULT 'ledger' CHECK (source IN ('opening','ledger','adjustment')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, date)
);
CREATE INDEX account_balances_user_date_idx ON account_balances (user_id, date);

-- ---------------------------------------------------------------- categories & tags
CREATE TABLE categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind             text NOT NULL CHECK (kind IN ('expense','income')),
  icon             text NOT NULL DEFAULT 'circle',
  color            text NOT NULL DEFAULT '#8a8a8a',
  is_system        boolean NOT NULL DEFAULT false,
  is_discretionary boolean NOT NULL DEFAULT false,
  is_archived      boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_user_kind_name_key ON categories (user_id, kind, lower(name));

CREATE TABLE tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color      text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_user_name_key ON tags (user_id, lower(name));

-- ---------------------------------------------------------------- imports
CREATE TABLE imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  total_rows     integer NOT NULL DEFAULT 0,
  imported_rows  integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  error_rows     integer NOT NULL DEFAULT 0,
  skipped_rows   integer NOT NULL DEFAULT 0,
  errors         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imports_user_idx ON imports (user_id, created_at DESC);

-- ---------------------------------------------------------------- recurring payments
CREATE TABLE recurring_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  merchant      text,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL CHECK (currency IN ('MAD','EUR','USD','GBP')),
  frequency     text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','annually','custom')),
  interval_days integer CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  account_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  next_date     date NOT NULL,
  last_paid_date date,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_custom_interval CHECK (frequency <> 'custom' OR interval_days IS NOT NULL)
);
CREATE INDEX recurring_user_next_idx ON recurring_payments (user_id, next_date);

-- ---------------------------------------------------------------- transactions
-- Accounting conventions (see src/lib/finance/ledger.ts):
--   income     : money in. Counted as income.            Account value +account_amount.
--   expense    : money out. Counted as expense.          Account value -account_amount.
--   refund     : money returned for an expense. Reduces that category's expenses (never income).
--   transfer   : between two owned accounts (incl. credit-card payments). Never income/expense.
--                From account -account_amount, to account +to_amount.
--   adjustment : manual balance correction. Never income/expense. Signed amount.
-- "Account value" is asset-perspective: a liability's value is minus the amount owed,
-- so a card purchase (expense) increases what is owed and a payment (transfer in) reduces it.
CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id   uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  type            text NOT NULL CHECK (type IN ('income','expense','transfer','refund','adjustment')),
  status          text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending')),
  date            date NOT NULL,
  amount          numeric(14,2) NOT NULL,          -- original amount, in `currency`
  currency        char(3) NOT NULL CHECK (currency IN ('MAD','EUR','USD','GBP')),
  account_amount  numeric(14,2) NOT NULL,          -- same amount in the account's currency
  fx_rate         numeric(18,8),                   -- currency -> account currency, when they differ
  to_amount       numeric(14,2),                   -- transfers: amount received by to_account
  merchant        text NOT NULL DEFAULT '' CHECK (length(merchant) <= 120),
  description     text,
  category_id     uuid REFERENCES categories(id) ON DELETE SET NULL,
  category_source text NOT NULL DEFAULT 'manual' CHECK (category_source IN ('manual','rule','suggestion','import','none')),
  notes           text,
  is_reviewed     boolean NOT NULL DEFAULT false,
  recurring_payment_id uuid REFERENCES recurring_payments(id) ON DELETE SET NULL,
  import_id       uuid REFERENCES imports(id) ON DELETE SET NULL,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tx_amount_sign CHECK ((type = 'adjustment' AND amount <> 0) OR (type <> 'adjustment' AND amount > 0)),
  CONSTRAINT tx_account_amount_sign CHECK ((type = 'adjustment' AND account_amount <> 0) OR (type <> 'adjustment' AND account_amount > 0)),
  CONSTRAINT tx_transfer_shape CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id AND to_amount IS NOT NULL AND to_amount > 0)
    OR (type <> 'transfer' AND to_account_id IS NULL AND to_amount IS NULL)),
  CONSTRAINT tx_no_category_on_transfer CHECK (type NOT IN ('transfer','adjustment') OR category_id IS NULL)
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, date DESC, created_at DESC);
CREATE INDEX transactions_account_idx ON transactions (account_id, date);
CREATE INDEX transactions_to_account_idx ON transactions (to_account_id, date) WHERE to_account_id IS NOT NULL;
CREATE INDEX transactions_category_idx ON transactions (user_id, category_id);
CREATE INDEX transactions_merchant_idx ON transactions (user_id, lower(merchant));

CREATE TABLE transaction_splits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_splits_tx_idx ON transaction_splits (transaction_id);

CREATE TABLE transaction_tags (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX transaction_tags_tag_idx ON transaction_tags (tag_id);

CREATE TABLE transaction_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  match_mode  text NOT NULL DEFAULT 'all' CHECK (match_mode IN ('all','any')),
  conditions  jsonb NOT NULL,
  actions     jsonb NOT NULL,
  priority    integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  times_applied integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_rules_user_idx ON transaction_rules (user_id, priority);

-- ---------------------------------------------------------------- budgets
CREATE TABLE budgets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month            date NOT NULL CHECK (extract(day FROM month) = 1),
  rollover_enabled boolean NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE TABLE budget_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_id   uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),   -- in the user's base currency
  rollover    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, category_id)
);
CREATE INDEX budget_allocations_user_idx ON budget_allocations (user_id);

-- ---------------------------------------------------------------- goals
CREATE TABLE savings_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind              text NOT NULL DEFAULT 'general',
  target_amount     numeric(14,2) NOT NULL CHECK (target_amount > 0),
  currency          char(3) NOT NULL CHECK (currency IN ('MAD','EUR','USD','GBP')),
  target_date       date,
  linked_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  description       text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  is_emergency_fund boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX savings_goals_user_idx ON savings_goals (user_id);

-- Contributions are allocations of money the user already owns. They are never
-- expenses. When money physically moves, the linked transaction is a transfer.
CREATE TABLE goal_contributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id        uuid NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount         numeric(14,2) NOT NULL CHECK (amount <> 0),    -- negative = withdrawal
  date           date NOT NULL,
  note           text,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, date);

-- ---------------------------------------------------------------- currency
-- 1 unit of base_currency = rate units of quote_currency, as of rate_date.
CREATE TABLE exchange_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_currency  char(3) NOT NULL CHECK (base_currency IN ('MAD','EUR','USD','GBP')),
  quote_currency char(3) NOT NULL CHECK (quote_currency IN ('MAD','EUR','USD','GBP')),
  rate           numeric(18,8) NOT NULL CHECK (rate > 0),
  rate_date      date NOT NULL,
  source         text NOT NULL DEFAULT 'manual',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency),
  UNIQUE (user_id, base_currency, quote_currency, rate_date)
);

-- ---------------------------------------------------------------- insights
CREATE TABLE recommendations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint  text NOT NULL,
  type         text NOT NULL CHECK (type IN ('spending','budget','savings','recurring','cash_flow','goals','data_quality')),
  priority     text NOT NULL CHECK (priority IN ('high','medium','low')),
  basis        text NOT NULL CHECK (basis IN ('actual','projection','scenario')),
  title        text NOT NULL,
  body         text NOT NULL,
  figures      jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions  text,
  action       jsonb,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','dismissed','completed')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);

-- ---------------------------------------------------------------- ledger view
-- One row per account movement. security_invoker makes the view obey the caller's RLS.
CREATE VIEW ledger_entries WITH (security_invoker = true) AS
  SELECT t.id AS transaction_id, t.user_id, t.account_id, t.date, t.status,
         CASE t.type
           WHEN 'income'     THEN t.account_amount
           WHEN 'refund'     THEN t.account_amount
           WHEN 'expense'    THEN -t.account_amount
           WHEN 'transfer'   THEN -t.account_amount
           WHEN 'adjustment' THEN t.account_amount
         END AS delta
    FROM transactions t
  UNION ALL
  SELECT t.id, t.user_id, t.to_account_id, t.date, t.status, t.to_amount
    FROM transactions t
   WHERE t.type = 'transfer';

-- ---------------------------------------------------------------- updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','profiles','accounts','account_balances','categories','tags',
    'imports','recurring_payments','transactions','transaction_splits','transaction_tags','transaction_rules',
    'budgets','budget_allocations','savings_goals','goal_contributions','exchange_rates','recommendations','audit_logs']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
