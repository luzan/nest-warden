import { Injectable, Scope } from '@nestjs/common';
import { MissingTenantContextError } from '../core/errors.js';
import type { TenantContext } from '../core/tenant-context.js';
import type { TenantIdValue } from '../core/tenant-id.js';

/**
 * REQUEST-scoped holder for the resolved {@link TenantContext}.
 *
 * Populated by `TenantContextInterceptor` once per authenticated request
 * (after the JWT guard has run, before the policies guard). All
 * downstream consumers — services, guards, the ability factory — read
 * from here. Treats reads before population as a programmer error and
 * throws {@link MissingTenantContextError}.
 *
 * Use `@Inject` (the class is its own token) anywhere you need the
 * tenant context in REQUEST-scoped consumers:
 *
 * @example
 *   @Injectable({ scope: Scope.REQUEST })
 *   export class MerchantService {
 *     constructor(private readonly tenantContext: TenantContextService) {}
 *
 *     listMine() {
 *       const { tenantId } = this.tenantContext.get();
 *       return this.repo.find({ where: { tenantId } });
 *     }
 *   }
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService<TId extends TenantIdValue = string> {
  private context: TenantContext<TId> | null = null;

  /**
   * Set the resolved context. Called by the interceptor exactly once per
   * request; subsequent calls overwrite (useful for impersonation flows
   * that swap context mid-request, but unusual).
   */
  set(context: TenantContext<TId>): void {
    this.context = context;
  }

  /**
   * Read the resolved context. Throws {@link MissingTenantContextError}
   * if called before the interceptor has populated it — a fail-closed
   * default that prevents accidentally querying without a tenant scope.
   */
  get(): TenantContext<TId> {
    if (this.context === null) {
      throw new MissingTenantContextError(
        'TenantContextService.get() called before TenantContextInterceptor ran. ' +
          'Ensure the interceptor is registered (it is by default when registerAsGlobal is true) ' +
          'and the route is not marked @Public().',
      );
    }
    return this.context;
  }

  /** Whether `set()` has been called for this request. */
  has(): boolean {
    return this.context !== null;
  }

  /**
   * Convenience accessor for the tenant ID — equivalent to `.get().tenantId`.
   * Throws if context isn't set.
   */
  get tenantId(): TId {
    return this.get().tenantId;
  }
}
