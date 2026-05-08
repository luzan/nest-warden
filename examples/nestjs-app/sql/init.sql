-- Bootstrap script for the nest-warden example app.
-- Run automatically by docker-compose on first container start; the test
-- suite invokes the same statements against testcontainers Postgres.

-- The application user owns all tables and runs without BYPASSRLS. RLS
-- policies enforce tenant isolation regardless of any application bug.
-- A separate `app_admin` role is reserved for migrations / scheduled
-- jobs that need to read across tenants; it carries BYPASSRLS but is
-- never used by request-handling code.
CREATE ROLE app_admin NOLOGIN BYPASSRLS;

-- Tenants table: the root of the isolation tree. Carries no tenant_id
-- (it IS the tenant). Read-only for application users; managed via
-- system jobs.
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Agents: a tenant-scoped role. Each agent works for exactly one tenant
-- and has a many-to-many relationship to merchants via assignments.
CREATE TABLE IF NOT EXISTS agents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  email       text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Merchants: the primary business resource. Tenant-scoped. Can be assigned
-- to zero or more agents.
-- `deleted_at` enables TypeORM's soft-delete pattern. NULL means live;
-- non-null means soft-deleted. TypeORM's QueryBuilder excludes
-- non-null rows from `getMany()` by default; pass `.withDeleted()`
-- to include them. RLS and `accessibleBy()` predicates compose with
-- this filter via AND, so soft-deleted rows still respect tenant
-- isolation when surfaced via `withDeleted: true`.
CREATE TABLE IF NOT EXISTS merchants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  name        text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('active','pending','closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);

-- Agent ↔ Merchant assignments (many-to-many). Used by the relationship
-- graph in the example app: `agents_of_merchant` resolves through this
-- table. Carries `tenant_id` for defense in depth — the FK constraints
-- guarantee tenant alignment, and RLS applies independently.
CREATE TABLE IF NOT EXISTS agent_merchant_assignments (
  agent_id     uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  merchant_id  uuid        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, merchant_id)
);

-- Payments: tenant-scoped, foreign-keyed to merchants. Demonstrates
-- multi-hop reverse lookups (Payment → Merchant → Agent).
CREATE TABLE IF NOT EXISTS payments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id),
  merchant_id   uuid        NOT NULL REFERENCES merchants(id),
  amount_cents  bigint      NOT NULL CHECK (amount_cents >= 0),
  status        text        NOT NULL CHECK (status IN ('pending','authorized','captured','refunded')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Row-Level Security ──────────────────────────────────────────────────
-- Each tenant-bearing table gets a PERMISSIVE policy (the default kind
-- when `AS RESTRICTIVE` is omitted): rows whose `tenant_id` matches
-- the session variable `app.current_tenant_id` are visible; everything
-- else is denied. With `FORCE ROW LEVEL SECURITY` the policy applies
-- even to the table owner. The session variable is set by
-- `RlsTransactionInterceptor` (or test fixtures) before any SQL runs
-- in a transaction.
--
-- Postgres derives a default `WITH CHECK` clause from `USING` for
-- INSERT and UPDATE, so a row whose `tenant_id` doesn't match the
-- active session is rejected at write time — exercised by
-- `test/e2e/rls-isolation.e2e.test.ts`.
--
-- WARNING — PERMISSIVE vs RESTRICTIVE:
--
-- Postgres combines policies as `(P1 OR P2 OR …) AND R1 AND R2 AND …`
-- where `P` are PERMISSIVE and `R` are RESTRICTIVE. A table with ONLY
-- `RESTRICTIVE` policies effectively denies every row, because the
-- PERMISSIVE chain (which grants access) is empty. Earlier versions of
-- this script used `AS RESTRICTIVE` and silently returned zero rows
-- for matching tenants — a footgun documented in the
-- `examples/nestjs-app/FINDINGS.md` § 2.
--
-- For production, the recommended pattern is one PERMISSIVE policy
-- per role (granting that role's scope) plus a RESTRICTIVE policy
-- enforcing tenant isolation. The example uses plain PERMISSIVE
-- policies because there's only one role-shape (the `app_user`).

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON merchants
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_merchant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_merchant_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_merchant_assignments
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- The `tenants` table itself is intentionally unrestricted — every
-- authenticated user can look up their own tenant's metadata. Sensitive
-- columns (billing, admin) would live on a separate, restricted table
-- in a real system.
