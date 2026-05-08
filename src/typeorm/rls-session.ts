import type { TenantIdValue } from '../core/tenant-id.js';

/**
 * Default Postgres session variable name set on the connection before
 * each transaction. Customize via `RlsSessionOptions.variableName` if
 * your RLS policies use a different key.
 */
export const DEFAULT_RLS_SESSION_VARIABLE = 'app.current_tenant_id';

/**
 * Build a parameterized statement that pins the tenant ID on the current
 * PostgreSQL transaction. Pair with row-level-security policies of the
 * form:
 *
 *   ```sql
 *   CREATE POLICY tenant_isolation ON merchants
 *     AS RESTRICTIVE
 *     USING (tenant_id::text = current_setting('app.current_tenant_id', true));
 *   ```
 *
 * Implementation note — Postgres's `SET LOCAL <name> = <value>` does NOT
 * accept bound parameters in the value position (it's a parser-level
 * statement, not an executor-level one). We therefore use the
 * `set_config(name, value, is_local)` function form, which is fully
 * parameterizable and semantically equivalent. The third arg (`is_local
 * = true`) makes the setting transaction-scoped.
 *
 * Pooled connections returned to the pool reset to the system default at
 * commit/rollback, so there's no risk of a stale value bleeding across
 * requests as long as every query runs inside a transaction.
 *
 * Returns a `[sql, params]` tuple ready to pass to TypeORM's
 * `queryRunner.query(sql, params)` — both the variable name AND the
 * value are bound, so neither is vulnerable to SQL injection.
 *
 * @param tenantId - The resolved tenant ID; coerced to text by Postgres.
 * @param variableName - The session variable name. Defaults to
 *   {@link DEFAULT_RLS_SESSION_VARIABLE}.
 *
 * @example
 *   const [sql, params] = buildRlsSet(tenantId);
 *   await queryRunner.query(sql, [...params]);
 */
export function buildRlsSet(
  tenantId: TenantIdValue,
  variableName: string = DEFAULT_RLS_SESSION_VARIABLE,
): readonly [string, readonly unknown[]] {
  if (!isValidVariableName(variableName)) {
    throw new Error(
      `Invalid RLS variable name "${variableName}": must be a dotted identifier ` +
        `(letters, digits, underscores, dots only). Postgres requires this format ` +
        `for custom GUC names.`,
    );
  }
  return ['SELECT set_config($1, $2, true)', [variableName, String(tenantId)]];
}

function isValidVariableName(name: string): boolean {
  // Custom GUC names: letters, digits, underscores, dots. No semicolons,
  // no quotes. Reject anything that could be SQL-meaningful.
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(name);
}
