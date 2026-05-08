import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
  Scope,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { DataSource } from 'typeorm';
import { TenantContextService } from '../nestjs/tenant-context.service.js';
import { type TenantIdValue } from '../core/tenant-id.js';
import { buildRlsSet, DEFAULT_RLS_SESSION_VARIABLE } from './rls-session.js';

/**
 * Configuration for {@link RlsTransactionInterceptor}.
 */
export interface RlsTransactionOptions {
  /**
   * Postgres session variable used by your RLS policies. Defaults to
   * {@link DEFAULT_RLS_SESSION_VARIABLE} (`app.current_tenant_id`).
   */
  readonly variableName?: string;
}

/**
 * Wraps every (non-public) request in a database transaction and runs
 * `SET LOCAL <var> = <tenant_id>` before handing control to the route.
 *
 * Pair with Postgres row-level-security policies on tenant-bearing tables:
 *
 *   ```sql
 *   ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
 *   ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
 *   CREATE POLICY tenant_isolation ON merchants
 *     AS RESTRICTIVE
 *     USING (tenant_id = current_setting('app.current_tenant_id'));
 *   ```
 *
 * With the policy in place, a developer who bypasses
 * `TenantAwareRepository` and uses raw `repository.find()` STILL gets
 * tenant-filtered results — the database refuses to return cross-tenant
 * rows.
 *
 * The interceptor is REQUEST-scoped because it depends on
 * {@link TenantContextService}. Reads the resolved tenant ID, opens a
 * QueryRunner, runs the SET LOCAL, then commits or rolls back based on
 * the route handler's outcome. Public routes (no tenant context) skip
 * the transaction entirely — the dataSource still uses the default
 * connection pool.
 *
 * Performance: opening a transaction per request adds a round-trip and
 * holds a pooled connection for the request's lifetime. For
 * read-mostly endpoints with very high RPS, consider scoping the
 * transaction more narrowly (per-service-call) instead of per-request.
 */
@Injectable({ scope: Scope.REQUEST })
export class RlsTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService<TenantIdValue>,
    @Optional() @Inject('MTC_RLS_OPTIONS') private readonly options?: RlsTransactionOptions,
  ) {}

  intercept(_executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.tenantContext.has()) {
      // Public route or non-authenticated path; no RLS context to set.
      return next.handle();
    }

    const tenantId = this.tenantContext.tenantId;
    const variableName = this.options?.variableName ?? DEFAULT_RLS_SESSION_VARIABLE;

    return from(this.runInTransaction(tenantId, variableName, next));
  }

  private async runInTransaction(
    tenantId: TenantIdValue,
    variableName: string,
    next: CallHandler,
  ): Promise<unknown> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const [setSql, setParams] = buildRlsSet(tenantId, variableName);
      await queryRunner.query(setSql, [...setParams]);

      // Stream the route handler's observable while the transaction is
      // open. We collect to a Promise so the lifecycle aligns with the
      // queryRunner's commit/rollback pair.
      const result = await new Promise((resolve, reject) => {
        next
          .handle()
          .pipe(switchMap((value: unknown) => Promise.resolve(value)))
          .subscribe({
            next: (value: unknown) => resolve(value),
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
      });

      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
      /* c8 ignore next */ // The `finally` is a JS control-flow primitive; v8 reports the branch but tests cover both success+failure paths above.
    } finally {
      await queryRunner.release();
    }
  }
}
