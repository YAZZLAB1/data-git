-- Row-level security. Application queries for a signed-in user run inside a
-- transaction that does `SET LOCAL ROLE finance_app` and sets app.user_id, so
-- PostgreSQL itself refuses to return or modify another user's rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    CREATE ROLE finance_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- Allow the connecting role to switch into finance_app (needed on managed
  -- Postgres such as Supabase where the connecting role is not a superuser).
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT finance_app TO %I', current_user);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO finance_app;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO finance_app;

-- users: a signed-in user can read their own row only (no password changes through RLS role).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_self ON users FOR SELECT TO finance_app USING (id = app_current_user_id());
GRANT SELECT (id, email, created_at, updated_at) ON users TO finance_app;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner ON sessions FOR ALL TO finance_app
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
GRANT SELECT, DELETE ON sessions TO finance_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','accounts','account_balances','categories','tags','imports',
    'recurring_payments','transactions','transaction_splits','transaction_tags','transaction_rules',
    'budgets','budget_allocations','savings_goals','goal_contributions','exchange_rates',
    'recommendations','audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO finance_app USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())', t || '_owner', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO finance_app', t);
  END LOOP;
END $$;

-- Audit trail is append-only for the application role (rows are only removed when the
-- user account itself is deleted, via ON DELETE CASCADE from users).
REVOKE UPDATE, DELETE ON audit_logs FROM finance_app;

GRANT SELECT ON ledger_entries TO finance_app;
