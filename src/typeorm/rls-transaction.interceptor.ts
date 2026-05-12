import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
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

  /**
   * Suppress the one-time startup warning that logs when the
   * interceptor is first constructed. The warning describes the
   * per-request connection-holding behaviour and links to the
   * "Auto-setting the RLS session variable" recipe. Set this to
   * `true` if you've already audited the trade-off and don't want
   * the log line on startup.
   */
  readonly silentStartupWarning?: boolean;
}

/**
 * Wraps every (non-public) request in a database transaction and runs
 * `SELECT set_config('app.current_tenant_id', $1, true)` before handing
 * control to the route. Pair with Postgres row-level-security policies
 * on tenant-bearing tables.
 *
 * **Demoted to recipe-status in 0.5.2-alpha.** The interceptor still
 * ships and works, but it's no longer the recommended default. The
 * full why-and-when discussion plus alternative strategies (scoped
 * transactions, TypeORM subscriber pattern, PgBouncer caveats) live
 * in [the recipes page](https://github.com/luzan/nest-warden/blob/main/docs/pages/docs/advanced/recipes.md#auto-setting-the-rls-session-variable).
 *
 * **Why "demoted":** the interceptor opens a Postgres transaction per
 * request — including for read-only routes — and holds a pooled
 * connection for the request's lifetime. For high-RPS workloads this
 * is meaningful pool pressure. The implementation is also short
 * enough (~30 lines) that most of the value is in the *explanation*
 * (the `set_config` vs `SET LOCAL` distinction, the
 * fail-closed default of `current_setting(..., true)`) rather than
 * the importable class. Different apps want different strategies
 * for setting the session variable; the recipe documents three.
 *
 * **What hasn't changed:** the export is still here. Existing
 * consumers who've wired the interceptor and validated the trade-off
 * don't need to change anything beyond optionally passing
 * `silentStartupWarning: true` to suppress the new one-shot log line
 * on cold start.
 *
 * The interceptor is REQUEST-scoped because it depends on
 * {@link TenantContextService}. Reads the resolved tenant ID, opens a
 * QueryRunner, runs `set_config(...)`, then commits or rolls back
 * based on the route handler's outcome. Public routes (no tenant
 * context) skip the transaction entirely.
 */
@Injectable({ scope: Scope.REQUEST })
export class RlsTransactionInterceptor implements NestInterceptor {
  /**
   * Class-level flag so the one-time startup warning fires on the
   * first request only, not once per request. Resets on module
   * re-import (test isolation boundaries, hot reload), which is the
   * intended behaviour — each fresh module load is "cold start" and
   * deserves the warning again.
   */
  private static startupWarningEmitted = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService<TenantIdValue>,
    @Optional() @Inject('MTC_RLS_OPTIONS') private readonly options?: RlsTransactionOptions,
  ) {
    if (
      !RlsTransactionInterceptor.startupWarningEmitted &&
      this.options?.silentStartupWarning !== true
    ) {
      RlsTransactionInterceptor.startupWarningEmitted = true;
      new Logger(RlsTransactionInterceptor.name).warn(
        'RlsTransactionInterceptor wraps every authenticated request in a ' +
          'Postgres transaction (including read-only routes) and holds a pool ' +
          "connection for each request's lifetime. For high-RPS workloads, " +
          'consider scoping the transaction to specific service methods, or ' +
          'setting `app.current_tenant_id` via a TypeORM subscriber without ' +
          'opening a transaction. See "Auto-setting the RLS session variable" ' +
          'in docs/advanced/recipes for the full trade-off + alternatives. ' +
          'Pass `silentStartupWarning: true` to suppress this notice once ' +
          "you've audited the choice.",
      );
    }
  }

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
